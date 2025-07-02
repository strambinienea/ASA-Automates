import Logger from "../utils/logger.js";
import config from "../config.js";
import {agent} from "../coordinator.js";

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

    /**
     * Client will be passed to the plans, to emit signals
     * @type { DeliverooApi }
     */
    #client

    /**
     * @type { [string] } predicate is in the form ['go_to', x, y]
     */
    #predicate;


    constructor(parent, predicate, client) {

        this.#parent = parent;
        this.#predicate = predicate;
        this.#client = client;
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
        for ( const planClass of config.PLAN_LIBRARY ) {

            if ( this.stopped ) throw ['stopped intention', ...this.predicate];

            const predicate = planClass.parsePredicate(this.predicate);
            if ( planClass.isApplicableTo(predicate) ) {
                this.#current_plan = new planClass(this.#parent, this.#client);
                Logger.info('Achieving intention ', predicate, ' with plan ', planClass.name);

                try {
                    const plan_res = await this.#current_plan.execute(predicate);

                    Logger.debug(
                        'Intention ', predicate,
                        ' successfully completed using plan ', planClass.name,
                        ' with result: ', plan_res
                    );
                    
                    return plan_res
                } catch (error) {
                    Logger.error(
                        'Intention ', predicate,
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