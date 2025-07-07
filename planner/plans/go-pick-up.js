import Plan from "./plan.js";
import Logger from "../../utils/logger.js";
import {agent} from "../../coordinator.js";


/**
 * @typedef GoPickUpPredicate
 * @property {string} action - The action to execute
 * @property {number} x - x coordinate of the parcel
 * @property {number} y - y coordinate of the parcel
 * @property {string} id - id of the parcel to pick up
 */

/**
 * Simple plan that executes the action of picking up a parcel
 */
class GoPickUp extends Plan {

    /**
     * Parse the predicate in list form (e.g. ['go_to', x, y]) into the correct Plan instance class
     * @param { [string, number, number, string] } predicate - The predicate to parse
     * @return { GoPickUpPredicate } - The parsed predicate object
     */
    static parsePredicate(predicate) {

        // Validate predicate, the first three elements must be present; i.e., action and coordinates
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
            id: predicate[3] != null ? predicate[3] : null
        };
    }

    /**
     * Check if current Plan is applicable to a given intention
     * @param { GoPickUpPredicate } predicate - Contains the following:
     *  - `action`: The action to execute, must be equal to 'go_pick_up'
     *  - `_x`: x coordinate (**UNUSED**)
     *  - `_y`: y coordinate (**UNUSED**)
     *  - `_id`: id of the parcel to pick up (**UNUSED**)
     * @return {boolean} - True if this plan can resolve the intention, false otherwise
     */
    static isApplicableTo(predicate) {
        return predicate.action === 'go_pick_up';
    }

    /**
     * Execute the current plan to achieve the intention
     * @param { GoPickUpPredicate } predicate - Contains the following:
     *  - `_action`: The action to execute (**UNUSED**)
     *  - `x`: x coordinate of the parcel
     *  - `y`: y coordinate of the parcel
     *  - `id`: id of the parcel to pick up
     * @return {Promise<boolean>} - True when the plan has been correctly executed
     */
    async execute(predicate) {

        const {action, x, y} = predicate;

        Logger.debug('Executing ', action, ' plan to coordinates: [', x, ', ', y, ']');

        if ( this.stopped ) {
            throw ['stopped'];
        }

        // Check if agent is already on the right tile, if so skip move
        const {x: agentX, y: agentY} = await agent.getCurrentPosition();
        if ( agentX === x && agentY === y ) {
            if ( this.stopped ) {
                throw ['stopped'];
            }

            await this._getClient().emitPickup()
            if ( this.stopped ) {
                throw ['stopped'];
            }
            return true;
        }

        if ( this.stopped ) {
            throw ['stopped'];
        }

        // Use a subintention to move to the correct tile
        await this.addSubIntention(['go_to', x, y]);
        if ( this.stopped ) {
            throw ['stopped'];
        }

        await this._getClient().emitPickup()
        if ( this.stopped ) {
            throw ['stopped'];
        }

        // Increase the counter of carried parcels
        if ( predicate.id != null ) {
            agent.pickedUpParcel(predicate.id);
        } else {
            Logger.warn('No parcel id passed to go_pick_up plan');
        }
        return true;
    }

}


export default GoPickUp;