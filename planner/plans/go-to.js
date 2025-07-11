import Plan from "./plan.js";
import Logger from "../../utils/logger.js";
import {agent} from "../../coordinator.js";
import WorldState from "../../belief/world-state.js";
import {findPath} from "../../utils/utils.js";


/**
 * @typedef GoToPredicate
 * @property {string} action - The action to execute
 * @property {number} x - x coordinate of the parcel
 * @property {number} y - y coordinate of the parcel
 */

/**
 * Plan that executes the action of moving to a specific tiles, using A* algorithm to find the preferable route
 */
class GoTo extends Plan {

    /**
     * Parse the predicate in list form (e.g. ['go_to', x, y]) into the correct Plan instance class
     * @param { [string, number, number] } predicate - The predicate to parse
     * @return { GoToPredicate } - The parsed predicate object
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
        };
    }

    /**
     * Check if current Plan is applicable to a given intention
     * @param { GoToPredicate } predicate - Contains the following:
     *  - `action`: The action to execute, must be equal to 'go_to'
     *  - `_x`: x coordinate to move to (**UNUSED**)
     *  - `_y`: y coordinate to move to (**UNUSED**)
     * @return {boolean} - True if this plan can resolve the intention, false otherwise
     */
    static isApplicableTo(predicate) {
        return predicate.action === 'go_to';
    }

    /**
     * Execute the current plan to achieve the intention
     * @param { GoToPredicate } predicate - Contains the following:
     *  - `action`: The action to execute, must be equal to 'go_to'
     *  - `x`: x coordinate to move to
     *  - `y`: y coordinate to move to
     * @return {Promise<boolean|*|boolean>} - True when the plan has been correctly executed
     */
    async execute(predicate) {


        const {action, x, y} = predicate;
        Logger.debug('Executing ', action, ' plan to coordinates: [', x, ', ', y, ']');
        const {x: startingX, y: startingY} = await agent.getCurrentPosition();

        // Check if agent is currently on the target tile, or if start and destination coincide, if so return empty path
        if ( startingX === x && startingY === y ) {
            Logger.info('Agent is already on the target tile');
            return true;
        }

        // Get best path to destination using A*
        const path = await findPath({x: startingX, y: startingY}, {x, y});

        if ( !path ) {
            throw ['no_path_found', startingX, startingY, x, y];
        }

        Logger.debug('Path found: ', path);

        // Follow the path step by step
        for ( const {x, y} of path ) {
            if ( this.stopped ) throw ['stopped'];

            // Fetch the current agent position
            const {x: agentX, y: agentY} = await agent.getCurrentPosition();

            Logger.debug('Next tile is ', x, ', ', y);
            Logger.debug("Current agent position: ", agentX, ", ", agentY);

            /** @type { 'up', 'down', 'left', 'right'} */
            let direction;
            if ( x > agentX ) {
                direction = 'right'
            } else if ( x < agentX ) {
                direction = 'left'
            } else if ( y > agentY ) {
                direction = 'up'
            } else if ( y < agentY ) {
                direction = 'down'
            }
            Logger.debug('Moving to ', direction);

            // Move the agent, try to move a couple of time, with a brief delay in the middle
            let hasMoved = false;
            let result;
            for ( let attempt = 0; attempt < 2; attempt++ ) {

                result = await this._getClient().emitMove(direction);
                if ( result ) {

                    Logger.debug("Move from ", agentX, ", ", agentY, " to ", x, ", ", y, " successful");
                    hasMoved = true;
                    break;
                }
                await new Promise(res => setTimeout(res, 10));
            }

            if ( !hasMoved ) {
                Logger.warn('Move from ', agentX, ', ', agentY, ' to ', x, ', ', y, ' failed, replanning');
                return false;
            }
        }
        return true;
    }
}

export default GoTo;