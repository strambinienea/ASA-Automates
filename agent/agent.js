import Intention from "./intention.js";
import Logger from "../utils/logger.js";
import {DeliverooApi} from "@unitn-asa/deliveroo-js-client";
import logger from "../utils/logger.js";
import WorldState from "../belief/world-state.js";

class Agent {

    /**
     * Current agent id, used for cross-agent communications
     * @type { string }
     */
    #agentId;

    #x;
    #y;

    /**
     * Deliveroo Client
     * @type { DeliverooApi }
     */
    #client;

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

    // TODO Type to Plan class
    /**
     * Library of plans used to solve achieve the intention
     * @type { [any] }
     */
    #planLibrary;

    /**
     * @type { [Intention] }
     */
    #intentionQueue;


    constructor(agentId, host, token, isLeader, companionId, planLibrary) {
        this.#agentId = agentId;
        this.#client = new DeliverooApi(host, token);
        this.#isLeader = isLeader;
        this.#companionId = companionId;
        this.#planLibrary = planLibrary;
        this.#intentionQueue = [];

        this.#client.onYou(({_id, _name, x, y, _score}) => {
            this.#x = x;
            this.#y = y;
        });

        Logger.setThreadContext(agentId);

        this.#client.onConnect(() => Logger.info('Connected to Deliveroo client'));
        this.#client.onDisconnect(() => Logger.info('Disconnected from Deliveroo client'));

        WorldState.observerWorldState(this.#client);
    }

    get intentionQueue() {
        return this.#intentionQueue;
    }

    get isLeader() {
        return this.#isLeader;
    }

    /**
     * @param {boolean} isLeader
     */
    set isLeader(isLeader) {
        this.#isLeader = isLeader;
    }

    get planLibrary() {
        return this.#planLibrary;
    }

    set planLibrary(planLibrary) {
        this.#planLibrary = planLibrary;
    }

    // <== GETTERS & SETTERS ==>

    get agentId() {
        return this.#agentId;
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
                Logger.debug('Current intention: ', intention);

                // Start achieving current intention
                const response = await intention.achieve().catch(error => {
                    Logger.error('Error while achieving intention: ', intention, 'with error: ', error);
                });

                if ( response instanceof Intention ) {
                    Logger.debug('Intention already started');
                } else if ( response ) {
                    // TODO Do something if plan is successfully completed?
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

        // Check if intention is already in the queue
        if ( this.#intentionQueue.find(i => i.predicate.join(' ') === predicate.join(' ')) ) {
            Logger.debug("Intention [", predicate, "] is already in the queue, skipping it");
            return null;
        }

        const intention = new Intention(this, predicate, this.#planLibrary);
        this.#intentionQueue.push(intention);

        // Sort the queue with the new intention
        this.sortIntentionQueue();

        // If leader agent, then communicate to follower what parcels to ignore,
        // since they are already in this intentionQueue.
        // Do this in the push, since it's when the intentionQueue is updated with new information
        if ( await this.#sendParcelsToIgnore() === null ) {
            Logger.error('Failed to send parcels to ignore to follower agent');
        }

        Logger.debug('New intention pushed into intention queue: ', intention);
        return intention;
    }

    /**
     * Sort the intention queue of the agent priority is given to pickups (ordered by distance),
     * then drop off and move intentions (only consider one each of these last two)
     */
    sortIntentionQueue() {

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
        // });

        // TODO Consider ordering dropOff based on distance to
        const dropOffIntentions = this.#intentionQueue.filter(i => i.predicate[0] === 'go_drop_off');
        const goToIntentions = this.#intentionQueue.filter(i => i.predicate[0] === 'go_to');

        // Rebuild the intention queue, priority is given to pickups (ordered by distance),
        // then drop off and last is move (only consider one each of these last two)
        this.#intentionQueue = [
            ...pickUpIntentions,
            dropOffIntentions.length > 0 ? dropOffIntentions[0] : [],
            goToIntentions.length > 0 ? goToIntentions[0] : []
        ];
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
            console.debug('Agent: ' + ' sending message with parcels to ignore to follower agent - Follower ID: ', this.#companionId);

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
            console.debug('Follower agent, will not be sending messages');
            return null;
        }
    }

    // TODO Type to Plan class
    addPlanToLibrary(plan) {
        this.#planLibrary.push(plan);
    }
}

export {Agent}