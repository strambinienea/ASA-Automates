import Intention from "./intention.js";
import Logger from "../utils/logger.js";
import {DeliverooApi} from "@unitn-asa/deliveroo-js-client";
import WorldState from "../belief/world-state.js";
import generateOptions from "../planner/options-generation.js";
import Config from "../config.js";
import {findPath} from "../utils/utils.js";
import {agent} from "../coordinator.js";

const Hand2HandBehaviour = {
    NONE: 'none',               // Hand2Hand mode not active
    DELIVER: 'deliver',       // Hand2Hand mode active, agent can deliver the parcels
    GATHER: 'gather'            // Hand2Hand mode active, agent can gather parcels
};

class Agent {

    /**
     * Current agent id, used for cross-agent communications
     * @type { string }
     */
    #agentId;

    #x = -1;
    #y = -1;

    /**
     * Deliveroo Client
     * @type { DeliverooApi }
     */
    #client;

    /** @type { boolean } */
    #carryingParcel = false;

    #carriedParcel = 0;

    /**
     * Flag that identifies if the agent has been initialized
     * @type {boolean}
     */
    #initialized = false;

    /**
     * Flag that identifies if an agent is the leader or follower agent
     * @type { boolean }
     */
    #isLeader;

    /**
     * Flag that identifies if the agent is in hand2hand mode, used to change the behavior of the agent
     * @type { Hand2HandBehaviour }
     */
    #hand2HandMode = Hand2HandBehaviour.NONE;

    /**
     * Tile of the reachable depot for the agent.
     * @type { Tile }
     */
    #depot;

    /**
     * Tile where the GATHER agent will drop the parcels for the DELIVERY agent to collect and deposit.
     * @type { Tile }
     */
    #deliveryTile = null;

    /**
     * Other agent id, used for cross-agent communications. If null then it's single agent mode
     * @type { string }
     */
    #companionId;

    /**
     * @type { [Intention] }
     */
    #intentionQueue;

    /** @type{ [string] } */
    #parcelsToIgnore = [];


    constructor(agentId, host, token, isLeader, companionId) {
        this.#agentId = agentId;
        this.#client = new DeliverooApi(host, token);
        this.#isLeader = isLeader;
        this.#companionId = companionId;
        this.#intentionQueue = [];

        this.#client.onYou(({_id, _name, x, y, _score}) => {
            this.#x = x;
            this.#y = y;

            // Update the other agent with the current agent position
            /** @type{ CompanionPositionMessage } */
            const message = {
                action: 'companion_position',
                position: {
                    x: this.#x,
                    y: this.#y
                }
            };
            this.sendMessageToCompanion(message);
        });

        Logger.setThreadContext(agentId);

        this.#client.onConnect(() => Logger.info('Connected to Deliveroo client'));
        this.#client.onDisconnect(() => Logger.info('Disconnected from Deliveroo client'));

        // Sense if is carrying a parcel
        this.#client.onParcelsSensing((parcels) => {
            this.#carryingParcel = parcels.some(parcel => parcel.carriedBy === this.agentId)
        })

        // Handle reception of messages that are exchanged between agents, only set on dual agent mode.
        // Use the .bind so that the correct context is passed through the callback
        if ( Config.DUAL_AGENT ) {
            this.#client.onMsg(this.#handleParcelsToIgnoreMessage.bind(this))
            this.#client.onMsg(this.#handleHand2HandMessage.bind(this))
            this.#client.onMsg(this.#handleCompanionPositionMessage.bind(this))
        }

        // Setup option generation
        // this.#client.onYou(generateOptions);
        this.#client.onParcelsSensing(generateOptions);
        this.#client.onAgentsSensing(generateOptions);

        // Also setup generation at fixed intervals, in case the agent get stuck
        setInterval(generateOptions, Config.OPTION_GENERATION_INTERVAL);

        // Setup listeners to gather map information
        WorldState.observerWorldState(this.#client);
    }

    /**
     *
     * @returns {Promise<void>}
     */
    async loop() {

        while ( true ) {

            // Consume intention in intentionQueue, else wait for a new one
            if (
                this.#intentionQueue.length > 0 &&
                this.#initialized
            ) {
                // Fetch current intention and action
                const intention = this.#intentionQueue.shift();

                // Start achieving current intention
                const response = await intention.achieve().catch(error => {
                    Logger.error('Error while achieving intention: ', intention, 'with error: ', error);
                });

                if ( response instanceof Intention ) {
                    Logger.debug('Intention already started');
                } else if ( response ) {
                    // TODO Do something if plan is successfully completed?
                    Logger.info('Intention ', intention.predicate, ' successfully completed');
                } else {
                    Logger.error('Error while achieving intention: ', intention);
                    // TODO REMOVE
                    Logger.info('Intention queue: ', this.#intentionQueue.map(i => i.predicate.join(' ')));
                }

            } else {
                await new Promise(res => setImmediate(res));
            }
        }
    }

    /**
     * Push a new intention into the intentionQueue
     * @param { [string] } predicate - New intention to push into intentionQueue
     * @returns {Promise<Intention>}
     */
    async push(predicate) {

        Logger.debug('Pushing new intention into intention queue: ', predicate);

        // Check if intention is already in the queue
        if ( this.#intentionQueue.find(i => i.predicate.join(' ') === predicate.join(' ')) ) {
            Logger.debug("Intention [", predicate, "] is already in the queue, skipping it");
            return null;
        }

        const intention = new Intention(this, predicate, this.#client);

        this.#intentionQueue.push(intention);

        // Sort the queue with the new intention
        await this.sortIntentionQueue();

        Logger.debug('New intention pushed into intention queue: ', intention.predicate);
        return intention;
    }

    /**
     * Sort the intention queue of the agent priority is given to pickups (ordered by distance),
     * then drop off and move intentions (only consider one each of these last two)
     */
    async sortIntentionQueue() {

        // Get the agent's current position, used to find the distance to the parcels
        const agentPosition = await agent.getCurrentPosition();

        // Sort pickups by distance (closest first)
        // Sort array using using the findPath utility to get the distance from agent to parcel with A* algorithm
        // Each parcel is mapped to it's distance, then sorted by distance. The map is necessary since
        // findPath is an async function, and cannot be used directly in the sort function.
        const distanceMap = await Promise.all(
            this.#intentionQueue
                .filter(i => i.predicate[0] === 'go_pick_up')
                .map(async (intention) => {
                    const parcel = {x: intention.predicate[1], y: intention.predicate[2]};
                    const path = await findPath(agentPosition, parcel);
                    return {intention, distance: path != null ? path.length : Infinity}; // Use Infinity if no path is found
                }));

        const pickUpIntentions = distanceMap
            .sort((a, b) => a.distance - b.distance)
            .map(i => i.intention);

        // TODO Could limit the number of parcel an agent can pickup, using the Config.MAX_CARRIED_PARCELS
        // Communicate to the other agent what parcels to ignore, since already in this queue
        if ( Config.DUAL_AGENT && agent.#hand2HandMode === Hand2HandBehaviour.NONE ) {
            await this.#sendParcelsToIgnore(pickUpIntentions.map(i => i.predicate[3]));
        }

        // TODO Consider ordering dropOff based on distance to
        const dropOffIntentions = this.#intentionQueue.filter(i => i.predicate[0] === 'go_drop_off');
        const goToIntentions = this.#intentionQueue.filter(i => i.predicate[0] === 'go_to');

        // Rebuild the intention queue, priority is given to pickups (ordered by distance),
        // then drop off and last is move (only consider one each of these last two)
        this.#intentionQueue = [...pickUpIntentions];
        if ( dropOffIntentions.length > 0 ) {
            this.#intentionQueue.push(dropOffIntentions[0]);
        }
        if ( goToIntentions.length > 0 ) {
            this.#intentionQueue.push(goToIntentions[0]);
        }

        // If the number of carried parcels is greater than the set threshold, then only consider drop off intentions
        if ( this.#carriedParcel >= Config.MAX_CARRIED_PARCELS ) {
            this.#intentionQueue = this.#intentionQueue.filter(i => i.predicate[0] === 'go_drop_off');
        }
    }

    /**
     * Method used to communicate to the other agent what parcels to ignore,
     * since they are already present in the current agent intentionQueue.
     * @param { [string] } parcels - List with ids of parcels to ignore
     */
    async #sendParcelsToIgnore(parcels) {

        Logger.debug(
            'Agent: ', this.agentId, 'sending message with parcels to ignore to follower agent - ' +
            'Follower ID: ', this.#companionId
        );

        /** @type { ParcelsToIgnoreMessage } */
        const message = {
            action: "multi_pickup",
            parcelIds: parcels,
        }

        // TODO Maybe only leader can send message, as was legacy code
        await this.#client.emitSay(this.#companionId, message);
    }

    /**
     * Check if the agent is able to deliver a parcel to at least one depot
     * @return {Promise<Tile|null>} The depot tile the agent can reach, null if no depot is reachable
     */
    async #checkIfCanDeliver() {
        const map = WorldState.getInstance().worldMap;
        const depots = await map.getDepotTilesAsync();
        const agentPosition = {x: this.#x, y: this.#y};

        for ( const depot of depots ) {
            if ( await findPath(agentPosition, {x: depot.x, y: depot.y}) != null ) {
                return depot;
            }
        }

        return null;
    }

    /**
     * Check if the agent is able to reach at least spawn point
     * @return {Promise<void>}
     */
    async #checkIfCanGather() {
        const map = WorldState.getInstance().worldMap;
        const spawnTiles = await map.getSpawnTilesAsync();
        const agentPosition = {x: this.#x, y: this.#y};

        for ( const spawn of spawnTiles ) {
            if ( await findPath(agentPosition, {x: spawn.x, y: spawn.y}) != null ) {
                return spawn;
            }
        }

        return null;
    }

    /**
     * Sends a message to the companion agent.
     * @param message {object} - The message to send to the companion agent.
     * @return {Promise<void>}
     */
    async sendMessageToCompanion(message) {
        await this.#client.emitSay(this.#companionId, message);
    }

    // <== MESSAGES HANDLER FUNCTIONS ==>

    /**
     * Handle the message received from the other agent regarding parcels to ignore.
     * Replace the current list with the one received.
     * @param _id
     * @param _name
     * @param { ParcelsToIgnoreMessage } message Message received from the other agent
     * @return {Promise<void>}
     */
    async #handleParcelsToIgnoreMessage(_id, _name, message) {
        if ( message.action === 'multi_pickup' ) {
            this.#parcelsToIgnore = [...message.parcelIds];
        } else {
            Logger.debug('Received message with unknown action: ', message.action);
        }
    }

    /**
     * Handle the hand2hand message received from the other agent. Set the hand2HandMode flag to true
     * @param _id
     * @param _name
     * @param { Hand2HandMessage } message Message received from the other agent
     * @return {Promise<void>}
     */
    async #handleHand2HandMessage(_id, _name, message) {

        if ( message.action === 'hand2hand' ) {

            if ( this.#initialized ) {
                Logger.info("Received hand2hand message, but agent is already initialized, ignoring it");
                return;
            }

            Logger.info('Agent: ', this.agentId, ' received hand2hand message');
            // Check if hand2hand mode is active
            if ( message.behavior === 'deliver' ) {

                const depot = await this.#checkIfCanDeliver()
                if ( !depot ) {
                    throw new Error('Unable to enter hand2hand mode: deliver, no depot reachable');
                }

                // Check if the agent can deliver parcels, if so set the hand2HandMode to DELIVERY
                this.#hand2HandMode = Hand2HandBehaviour.DELIVER;
                this.#client.onMsg(this.#handleDeliveryTileMessage.bind(this))

                // Set the depot tile for the agent, so it can be used later
                // This is used by the DELIVER agent to know where the deliver is,
                // used for consistency instead of fetching it every time
                this.#depot = depot;
                this.#initialized = true;

            } else if ( message.behavior === 'gather' && await this.#checkIfCanGather() != null ) {
                // Check if the agent can gather parcels, if so set the hand2HandMode to GATHER
                this.#hand2HandMode = Hand2HandBehaviour.GATHER;
                this.#client.onMsg(this.#handleDeliveryTileMessage.bind(this))

                this.#initialized = true;

            } else if ( message.behavior === 'none' ) {

                Logger.debug("Receiverd hand2hand message with behavior none, no need to change the behavior");
                this.#initialized = true;

            } else {
                // If not, then it means that both agents are stuck without a reachable depot
                throw new Error(
                    'Agent: ' + this.agentId + ' received hand2hand message, but cannot fulfill the behavior: ' + message.behavior
                );
            }

        } else {
            Logger.debug('Received message with unknown action: ', message.action);
        }
    }

    /**
     * Handle the delivery tile message received from the other agent.
     * Either set the delivery tile if the agent is GATHER or reset it if it is DELIVER
     * @param _id
     * @param _name
     * @param message { DeliveryTileMessage } - Message received from the other agent
     * @return {Promise<void>}
     */
    async #handleDeliveryTileMessage(_id, _name, message) {
        if ( message.action === 'delivery_tile' ) {

            switch ( message.status ) {

                case "set": {
                    if ( this.#hand2HandMode !== Hand2HandBehaviour.GATHER ) {
                        throw new Error(
                            'Received delivery tile message with status set, but hand2hand mode is not GATHER'
                        );
                    }

                    Logger.info('Received delivery tile message with status set');
                    this.deliveryTile = message.tile;

                    break
                }
                case "error": {
                    if ( this.#hand2HandMode !== Hand2HandBehaviour.DELIVER ) {
                        throw new Error(
                            'Received delivery tile message with status error, but hand2hand mode is not DELIVER'
                        );
                    }

                    Logger.warn('Received delivery tile message with status error');
                    this.deliveryTile = null;

                    break
                }
                default : {
                    throw new Error('Received message with unknown status: ' + message.status)
                }
            }
        } else {
            Logger.debug('Received message with unknown action: ', message.action);
        }
    }

    /**
     * Handle the delivery of the message received from the other agent regarding the companion position.
     * Also initialize the agent behavior, if the agent is the leader. It checks if the agent can reach a
     * depot or a spawn tile, and sets the hand2HandMode accordingly.
     * @param _id
     * @param _name
     * @param message { CompanionPositionMessage } - Message received from the other agent
     * @return {Promise<void>}
     */
    async #handleCompanionPositionMessage(_id, _name, message) {

        if ( message.action === 'companion_position' && message.position ) {

            Logger.debug('Received companion position message: ', message.position);
            const map = WorldState.getInstance().worldMap;

            if ( this.#isLeader ) {
                map.setFollowerPosition(message.position.x, message.position.y);
            } else {
                map.setLeaderPosition(message.position.x, message.position.y);
            }

            if ( Config.DUAL_AGENT && !this.#initialized && this.#isLeader ) {

                Logger.info("Initializing agent behavior")

                // Check if agents need to enter hand2hand mode or can use the default behavior
                const depot = await this.#checkIfCanDeliver();
                const spawn = await this.#checkIfCanGather();

                if ( !depot ) {

                    Logger.info("Agent set to GATHER mode, other agent must be DELIVER");

                    // Cannot deliver, enter GATHER behavior, the other agent must be DELIVER
                    await this.#client.emitSay(this.#companionId, {action: 'hand2hand', behavior: 'deliver'});
                    this.#hand2HandMode = Hand2HandBehaviour.GATHER;
                    this.#client.onMsg(this.#handleDeliveryTileMessage.bind(this));
                } else if ( !spawn ) {

                    Logger.info("Agent set to DELIVER mode, other agent must be GATHER");

                    // Cannot gather, enter DELIVER behavior, the other agent must be GATHER
                    await this.#client.emitSay(this.#companionId, {action: 'hand2hand', behavior: 'gather'});
                    this.#hand2HandMode = Hand2HandBehaviour.DELIVER;
                    this.#client.onMsg(this.#handleDeliveryTileMessage.bind(this));
                } else {

                    Logger.info("No need for hand2hand mode, agent can use default behavior");
                    await this.#client.emitSay(this.#companionId, {action: 'hand2hand', behavior: 'none'});
                }

                this.#initialized = true;
            }
        } else {
            Logger.debug('Received message with unknown action: ', message.action);
        }
    }

    // <== GETTERS & SETTERS ==>

    get agentId() {
        return this.#agentId;
    }

    get carryingParcel() {
        return this.#carryingParcel;
    }

    get parcelsToIgnore() {
        return this.#parcelsToIgnore;
    }

    get depot() {
        return this.#depot;
    }

    get hand2HandMode() {
        return this.#hand2HandMode;
    }

    get deliveryTile() {
        return this.#deliveryTile;
    }

    set deliveryTile(tile) {
        if ( tile === null || tile === undefined ) {
            this.#deliveryTile = null;
        } else {
            this.#deliveryTile = tile;
        }
    }

    /**
     * Return an object with the x and y coordinate of the agent.
     * Is an async function to await for the fetching of data while initializing agent, should only wait at startup
     * @return {Promise<{x: number, y: number}>}
     */
    async getCurrentPosition() {

        // Wait for position to be fetched from Deliveroo APIs
        while ( this.#x < 0 || this.#y < 0 ) {
            await new Promise(res => setImmediate(res));
        }

        return {x: this.#x, y: this.#y};
    }

    /**
     * Updates the agent's current parcel counter. Also remove the parcel from the world map.
     * @param parcelId {string} - The id of the parcel that has been picked up
     */
    pickedUpParcel(parcelId) {

        // Remove the picked up parcel from the list of available parcels
        const map = WorldState.getInstance().worldMap;
        map.parcelPickedUp(parcelId);

        this.#carriedParcel++;
    }

    /**
     * Clear the carried parcel counter, used when the agent drops off a parcel
     */
    dropAllParcels() {
        this.#carriedParcel = 0;
    }
}

// TYPE DEFINITIONS
/**
 * Type for the message sent or received regarding parcels to ignore.
 * @typedef ParcelsToIgnoreMessage
 * @property {string} action - The action of the message, should be 'multi_pickup'
 * @property {string[]} parcelIds - The list of parcel ids to ignore
 */

/**
 * Type for the message sent or received regarding hand2hand mode.
 * @typedef Hand2HandMessage
 * @property {string} action - The action of the message, should be 'hand2hand'
 * @property {string} behavior - The behavior that the recipient of the message must fulfill, can either be 'gather' or 'deliver'.
 */

/**
 * Type for the message sent or received regarding parcels to ignore.
 * @typedef DeliveryTileMessage
 * @property {string} action - The action of the message, should be 'delivery_tile'
 * @property {status} status - The status of the message, can either be 'set' or 'error'.
 * The first is used by the GATHER agent to set the delivery, the second is used by the GATHER agent to notify
 * the DELIVER agent that the tile is not reachable.
 * @property {Tile} tile - The tile chosen as the delivery tile.
 */

/**
 * Type for the message sent or received regarding the companion position in the map.
 * @typedef CompanionPositionMessage
 * @property {string} action - The action of the message, should be 'companion_position'
 * @property { x: number, y: number} position - The position of the companion agent in the map.
 */

export {Agent, Hand2HandBehaviour};