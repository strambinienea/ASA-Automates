import Logger from "../utils/logger.js";

/**
 * Intention
 */
class Intention {

    // Plan currently used for achieving the intention
    #current_plan;

    // This is used to stop the intention
    #stopped = false;
    #started = false;

    // Parent refers to caller
    #parent;

    // TODO Type to Plan class
    /**
     * Library of plans used to solve achieve the intention
     * @type { [any] }
     */
    #planLibrary;

    /**
     * @type { any[] } predicate is in the form ['go_to', x, y]
     */
    #predicate;


    constructor(parent, predicate, planLibrary) {
        this.#parent = parent;
        this.#predicate = predicate;
        this.#planLibrary = planLibrary;
    }

    get stopped() {
        return this.#stopped;
    }

    // <== GETTERS & SETTERS ==>

    /**
     * @type { any[] } predicate is in the form ['go_to', x, y]
     */
    get predicate() {
        return this.#predicate;
    }

    get planLibrary() {
        return this.#planLibrary;
    }

    set planLibrary(planLibrary) {
        this.#planLibrary = planLibrary;
    }

    /**
     * Using the plan library to achieve an intention
     * @return { Promise<Intention|any> }
     */
    async achieve() {

        // Cannot start twice
        if ( this.#started ) {
            return this;
        } else {
            this.#started = true;
        }

        // Trying all plans in the library
        for ( const planClass of this.#planLibrary ) {

            if ( this.stopped ) throw ['stopped intention', ...this.predicate];

            // If the plan is 'statically' applicable, then it's instantiated, executed, and the result is returned
            if ( planClass.isApplicableTo(...this.predicate) ) {
                this.#current_plan = new planClass(this.#parent);
                Logger.debug('Achieving intention ', ...this.predicate, ' with plan ', planClass.name);

                try {
                    const plan_res = await this.#current_plan.execute(...this.predicate);

                    Logger.debug(
                        'Intention ', ...this.predicate,
                        ' successfully completed using plan ', planClass.name,
                        ' with result: ', plan_res
                    );
                    return plan_res
                } catch (error) {
                    Logger.error(
                        'Intention ', ...this.predicate,
                        ' failed, using plan ', planClass.name,
                        ' with error: ', error
                    )
                }
            }
        }
        if ( this.stopped ) throw ['stopped intention', ...this.predicate];

        // No plans have been found to satisfy the intention
        Logger.debug('No plan satisfied the intention ', ...this.predicate);
        throw ['no plan satisfied the intention ', ...this.predicate]
    }

    stop() {
        this.#stopped = true;
        if ( this.#current_plan ) {
            this.#current_plan.stop();
        }
    }
}

export default Intention;