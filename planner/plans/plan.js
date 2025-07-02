import Logger from "../../utils/logger.js";
import Intention from "../../agent/intention.js";

/**
 * Base plan class. Contains the common logic shared between all the plans
 */
class Plan {

    #parent;
    #stopped = false;

    /**
     * Used to emit signals when executing a plan
     * @type { DeliverooApi }
     */
    #client;

    /**
     * Array of subintentions. Multiple one could be achieved in parallel.
     * @type { [Intention] }
     */
    #subIntentions = [];

    constructor(parent, client) {
        this.#parent = parent;
        this.#client = client;
    }

    get stopped() {
        return this.#stopped;
    }

    /**
     * Parse the predicate in list form (e.g. ['go_to', x, y]) into the correct Plan instance class
     * @param { [any] } predicate - The predicate to parse
     * @return { {} } - The parsed predicate object
     */
    static parsePredicate(predicate) {
        throw new Error('Not implemented');
    }

    /**
     * Check if current Plan is applicable to a given intention
     * @return {boolean} - True if this plan can resolve the intention, false otherwise
     */
    static isApplicableTo(predicate) {
        throw new Error('Not implemented');
    }

    async addSubIntention(predicate) {

        const subIntention = new Intention(this.#parent, predicate, this.#client);
        this.#subIntentions.push(subIntention);
        return subIntention.achieve();
    }

    // <== GETTERS & SETTERS ==>

    /**
     * Execute the current plan to achieve the intention
     * @return {Promise<boolean>} - True when the plan has been correctly executed
     */
    async execute(predicate) {
        throw new Error('Not implemented');
    }

    stop() {

        Logger.debug('Stopping plan ',);
        this.#stopped = true;
        for ( const i of this.#subIntentions ) {
            i.stop();
        }
    }

    _getClient() {
        return this.#client;
    }
}

export default Plan;