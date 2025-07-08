import Intention from "./intention.js";
import Logger from "../utils/logger.js";
import {DeliverooApi} from "@unitn-asa/deliveroo-js-client";
import WorldState from "../belief/world-state.js";
import generateOptions from "../planner/options-generation.js";
import Config from "../config.js";
import worldState from "../belief/world-state.js";
import {findPath} from "../utils/utils.js";
import {agent} from "../coordinator.js";

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
     * Flag that identifies if an agent is the leader or follower agent
     * @type { boolean }
     */
    #isLeader;

    // TODO Handle single agent mode
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
        });

        Logger.setThreadContext(agentId);

        this.#client.onConnect(() => Logger.info('Connected to Deliveroo client'));
        this.#client.onDisconnect(() => Logger.info('Disconnected from Deliveroo client'));

        // Sense if is carrying a parcel
        this.#client.onParcelsSensing((parcels) => {
            this.#carryingParcel = parcels.some(parcel => parcel.carriedBy === this.agentId)
        })

        // Handle reception of parcels to ignore message.
        // Use the .bind so that the correct context is passed through the callback
        if ( Config.DUAL_AGENT ) {
            this.#client.onMsg(this.#handleParcelsToIgnoreMessage.bind(this))
        }

        // Setup listeners to gather map information
        WorldState.observerWorldState(this.#client);

        // Setup option generation when receiving a sense event
        // this.#client.onYou(generateOptions);
        this.#client.onParcelsSensing(generateOptions);
        this.#client.onAgentsSensing(generateOptions);

        // Also setup generation at fixed intervals, in case the agent get stuck
        setInterval(generateOptions, Config.OPTION_GENERATION_INTERVAL);
    }

    /**
     *
     * @returns {Promise<void>}
     */
    async loop() {

        while ( true ) {

            // Consume intention in intentionQueue, else wait for a new one
            if ( this.#intentionQueue.length > 0 ) {
                // Fetch current intention and action
                const intention = this.#intentionQueue[0];

                // Start achieving current intention
                const response = await intention.achieve().catch(error => {
                    Logger.error('Error while achieving intention: ', intention, 'with error: ', error);
                });

                if ( response instanceof Intention ) {
                    Logger.debug('Intention already started');
                } else if ( response ) {
                    // TODO Do something if plan is successfully completed?
                    Logger.info('Intention successfully completed');
                    // if ( intention.predicate[0] === 'go_to' ) {
                    //
                    //     function getRandomInt(min, max) {
                    //         min = Math.ceil(min);   // Round up to the nearest integer
                    //         max = Math.floor(max);  // Round down to the nearest integer
                    //         return Math.floor(Math.random() * (max - min + 1)) + min;
                    //     }
                    //
                    //     await this.push(['go_to', getRandomInt(0, 10), getRandomInt(0, 10)]);
                    // }
                }

                // Remove intention from intentionQueue and continue
                this.#intentionQueue.shift();
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

        Logger.info('Pushing new intention into intention queue: ', predicate);

        // Check if intention is already in the queue
        if ( this.#intentionQueue.find(i => i.predicate.join(' ') === predicate.join(' ')) ) {
            Logger.warn("Intention [", predicate, "] is already in the queue, skipping it");
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
        if ( Config.DUAL_AGENT ) {
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
     * Method that returns true if the agent's intention queue contains a 'go_pick_up' intention
     * @returns {boolean} true if the agent's intention queue contains a 'go_pick_up' intention
     */
    hasPickupIntention() {
        return this.#intentionQueue.some(intention => intention.predicate[0] === 'go_pick_up');
    }

    /**
     * Type for the message sent or received regarding parcels to ignore.
     * @typedef ParcelsToIgnoreMessage
     * @property {string} action - The action of the message, should be 'multi_pickup'
     * @property {string[]} parcelIds - The list of parcel ids to ignore
     */


    /**
     * Method used to communicate to the other agent what parcels to ignore,
     * since they are already present in the current agent intentionQueue.
     * @param { [string] } parcels - List with ids of parcels to ignore
     */
    async #sendParcelsToIgnore(parcels) {

        Logger.info(
            'Agent: ', this.agentId, ' sending message with parcels to ignore to follower agent - ' +
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
            Logger.warn('Received message with unknown action: ', message.action);
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

export {Agent}