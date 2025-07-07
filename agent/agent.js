import Intention from "./intention.js";
import Logger from "../utils/logger.js";
import {DeliverooApi} from "@unitn-asa/deliveroo-js-client";
import WorldState from "../belief/world-state.js";
import generateOptions from "../planner/options-generation.js";
import Config from "../config.js";
import worldState from "../belief/world-state.js";

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
        this.sortIntentionQueue();

        // TODO Check and fix
        // If leader agent, then communicate to follower what parcels to ignore,
        // since they are already in this intentionQueue.
        // Do this in the push, since it's when the intentionQueue is updated with new information
        // if ( await this.#sendParcelsToIgnore() === null ) {
        //     Logger.error('Failed to send parcels to ignore to follower agent');
        // }

        Logger.debug('New intention pushed into intention queue: ', intention.predicate);

        return intention;
    }

    /**
     * Sort the intention queue of the agent priority is given to pickups (ordered by distance),
     * then drop off and move intentions (only consider one each of these last two)
     */
    sortIntentionQueue() {

        // TODO Implement
        // Sort pickups by distance (closest first)
        const pickUpIntentions = this.#intentionQueue
            .filter(i => i.predicate[0] === 'go_pick_up')
        // .sort((a, b) => {
        //     // Extract coordinates from predicates
        //     const [ax, ay] = [a.predicate[1], a.predicate[2]];
        //     const [bx, by] = [b.predicate[1], b.predicate[2]];
        //
        //     // Calculate distances
        //     // TODO ASTART IN UTILS CLASS
        //     // TODO Use a data class instead of global variable me for position
        //     // const distA = aStarDistance([me.x, me.y], [ax, ay]);
        //     // const distB = aStarDistance([me.x, me.y], [bx, by]);
        //
        //     return distA - distB; // Closest first
        // });s

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
     * Method used to communicate to the follower agent what parcels to ignore,
     * since they are already present in the leader intentionQueue.
     */
    async #sendParcelsToIgnore() {

        if ( this.#isLeader ) {
            Logger.info(
                'Agent: ', this.agentId, ' sending message with parcels to ignore to follower agent - ' +
                'Follower ID: ', this.#companionId
            );

            const parcels = []
            this.#intentionQueue.forEach(intention => {

                if ( intention.predicate[0] === 'go_pick_up' ) {
                    const [_action, _x, _y, id] = intention.predicate;
                    parcels.push(id);
                }
            })

            // TODO Import client from coordinator and send message
            // await client.emitSay(teamAgentId, {
            //         action: "multi_pickup",
            //         parcelIds: parcelIdss
            //     }
            // );
        } else {
            Logger.warn('Follower agent, will not be sending messages');
            return null;
        }
    }

    // <== GETTERS & SETTERS ==>

    get agentId() {
        return this.#agentId;
    }

    get intentionQueue() {
        return this.#intentionQueue;
    }

    get isLeader() {
        return this.#isLeader;
    }

    get carryingParcel() {
        return this.#carryingParcel;
    }

    /**
     * @param {boolean} isLeader
     */
    set isLeader(isLeader) {
        this.#isLeader = isLeader;
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

    pickedUpParcel(parcelId) {

        // Remove the picked up parcel from the list of available parcels
        const map = WorldState.getInstance().worldMap;
        map.parcelPickedUp(parcelId);

        this.#carriedParcel++;
    }

    dropAllParcels() {
        this.#carriedParcel = 0;
    }
}

export {Agent}