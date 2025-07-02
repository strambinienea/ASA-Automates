import Plan from "./plan.js";
import Logger from "../../utils/logger.js";
import {agent} from "../../coordinator.js";


/**
 * @typedef GoDropOffPredicate
 * @property {string} action - The action to execute
 * @property {number} x - x coordinate of the parcel
 * @property {number} y - y coordinate of the parcel
 * @property {number} parcelId - id of the parcel to pick up
 * @property {number} depotId - id of the depot tile
 */

/**
 * Simple plan that executes the action of dropping a parcel into a depot tile
 */
class GoDropOff extends Plan {

    /**
     * Parse the predicate in list form (e.g. ['go_to', x, y]) into the correct Plan instance class
     * @param { [string, number, number, number, number] } predicate - The predicate to parse
     * @return { GoDropOffPredicate } - The parsed predicate object
     */
    static parsePredicate(predicate) {

        // Validate predicate
        if (
            predicate.length < 3 ||
            predicate[0] === null ||
            predicate[1] === null ||
            predicate[2] === null
        ) {
            throw new Error('Invalid predicate passed. Predicate: ' + predicate);
        }

        return {
            action: predicate[0],
            x: predicate[1],
            y: predicate[2],
            parcelId: predicate[3] | null,
            depotId: predicate[4] | null
        };
    }

    /**
     * Check if current Plan is applicable to a given intention
     * @param { GoDropOffPredicate } predicate - Contains the following:
     *  - `action`: The action to execute, must be equal to 'go_drop_off'
     *  - `_x`: y coordinate (**UNUSED**)
     *  - `_y`: y coordinate (**UNUSED**)
     *  - `_parcelId`: id of the parcel to pickup (**UNUSED**)
     *  - `_depotId`: id of the depot tile (**UNUSED**)
     * @return {boolean} - True if this plan can resolve the intention, false otherwise
     */
    static isApplicableTo(predicate) {
        return predicate.action === 'go_drop_off';
    }

    /**
     * Execute the current plan to achieve the intention
     * @param { GoDropOffPredicate } predicate - Contains the following:
     *  - `action`: The action to execute
     *  - `x`: y coordinate
     *  - `y`: y coordinate
     *  - `_parcelId`: id of the parcel to pickup (**UNUSED**)
     *  - `_depotId`: id of the depot tile (**UNUSED**)
     * @return {Promise<boolean>} - True when the plan has been correctly executed
     */
    async execute(predicate) {

        const {action, x, y} = predicate;

        Logger.debug('Executing ', action, ' plan to coordinates: [', x, ', ', y, ']');

        if ( this.stopped ) {
            throw ['stopped'];
        }

        // Check if agent is already on the right tile, if so skip move
        const {agentX, agentY} = await agent.getCurrentPosition();
        if ( agentX === x && agentY === y ) {
            if ( this.stopped ) {
                throw ['stopped'];
            }

            await this._getClient().emitPutdown();
            if ( this.stopped ) {
                throw ['stopped'];
            }
            return true;
        }

        await this.addSubIntention(['go_to', x, y]);
        if ( this.stopped ) {
            throw ['stopped'];
        }

        await this._getClient().emitPutdown();
        if ( this.stopped ) {
            throw ['stopped'];
        }
        return true;
    }
}

export default GoDropOff;