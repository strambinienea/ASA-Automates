import Plan from "./plan.js";
import Logger from "../../utils/logger.js";
import {agent} from "../../coordinator.js";
import WorldState from "../../belief/world-state.js";
import {Heap} from "heap-js"

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
        const map = WorldState.getInstance().worldMap;

        // Get best path to destination using A*
        const path = await this.#findPath({x: startingX, y: startingY}, {x, y});

        if ( !path ) {
            throw ['no_path_found', startingX, startingY, x, y];
        }
        // If path is empty, then the agent is already at destination
        if ( path.length === 0 ) {
            return true;
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
                // TODO Maybe replan move? Currently keep trying
                return this.execute(predicate);
            }
        }
        return true;
    }

    /**
     * Try and find a path between the start and end position, using A* algorithm
     * @param { {x: number, y:number} } startPosition - The starting position
     * @param { {x: number, y:number} } endPosition - The target position
     * @param heuristic - The heuristic function to estimate the cost of the path between two nodes.s
     * By default, it is set to the Manhattan distance
     * @return { Promise<[{x: number, y:number}]> } - The path to follow to reach the end position,
     * if empty then no path was found
     */
    async #findPath(
        startPosition,
        endPosition,
        heuristic = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
    ) {

        const map = WorldState.getInstance().worldMap;
        const walkableTiles = await map.getWalkableTiles();

        // Check if destination is a walkable tile, if not return null
        if ( !walkableTiles.some(tile => tile.x === endPosition.x && tile.y === endPosition.y) ) {
            Logger.warn('Start or end position is not walkable');
            return null;
        }

        // Check if agent is currently on the target tile, or if start and destination coincide, if so return empty path
        const {agentX, agentY} = agent.getCurrentPosition();
        if (
            (startPosition.x === endPosition.x && startPosition.y === endPosition.y) ||
            (agentX === endPosition.x && agentY === endPosition.y)
        ) {
            Logger.info('Agent is already on the target tile, or start and destination coincide');
            return [];
        }

        // Populate the node list
        /** @type { Map<string, Node> } */
        const nodes = new Map();
        walkableTiles.forEach(tile => {
            nodes.set(
                `${tile.x},${tile.y}`,
                {
                    x: tile.x,
                    y: tile.y,
                    fScore: Infinity,
                    gScore: Infinity
                }
            )
        })

        // Used to sort nodes with lowest fScore first.
        // This score represents the best guess at how cheap the path could be passing from this node `n` (from start to finish).
        // It is formed by the current cost of the path traversed until now plus the cost estimated to arrive to the goal from `n`.
        // fScore(n) = gScore(n) + h(n) -> where h(n) is the estimated cost to the goal from n, using an heuristic.
        /** @type { function (Node, Node) : number } */
        const customComparator = (a, b) => a.fScore - b.fScore;

        // Min-heap queue of nodes to explore. At the start only the start position is set.
        // The starting node has gScore 0, since at the start no path has been tested,
        // and fScore equal to the heuristic from start to finish, which is the best approximation of the cheapest path
        const openSet = new Heap(customComparator);
        openSet.push({
            x: startPosition.x,
            y: startPosition.y,
            fScore: heuristic(startPosition, endPosition),
            gScore: 0
        });

        // Map used to link two nodes together, for a node,
        // cameFrom returns the node immediately preceding it on the cheapest path
        const cameFrom = new Map();

        while ( !openSet.isEmpty() ) {

            /** @type Node */
            const current = openSet.pop();

            // If current node is the goal, return the full path until now
            if ( current.x === endPosition.x && current.y === endPosition.y ) {

                const path = [];

                // Rebuild the path, by finding the previous node on the cheapest path
                let node = current;
                while ( cameFrom.has(node) ) {
                    path.push({x: node.x, y: node.y});
                    node = cameFrom.get(node);
                }

                // TODO Maybe need to exclude start position
                return path.reverse();
            }

            const neighbors = await map.getNeighborTiles({x: current.x, y: current.y});

            neighbors.forEach(({x, y}) => {

                // Fetch the neighbor node from the map, using its coordinates as key
                const neighbor = nodes.get(`${x},${y}`);

                // This is the distance from the start to the neighbor passing through current
                // It's found by the previous cost + 1, which is the cost of traversing one node
                const tentativeGScore = current.gScore + 1;

                // Check if the tentative score is less then the gScore of the neighbor,
                // if so, it means ww just found a better path
                if ( tentativeGScore < neighbor.gScore ) {

                    // Update the map, creating a path between the current node and the neighbor
                    cameFrom.set(neighbor, current);

                    // Update both scores for the neighbor with the new-found path
                    neighbor.gScore = tentativeGScore;
                    neighbor.fScore = neighbor.gScore + heuristic(neighbor, endPosition);

                    // If not already in the queue, add the neighbor to it, so that it can be used to finde new paths
                    if ( !openSet.contains(neighbor) ) {
                        openSet.add(neighbor);
                    }
                }
            })
        }

        Logger.warn('Could find not path between start and end position');
        return null;
    }
}

/**
 * Identifies a node, used in the path finding algorithm
 */
class Node {

    /** @type {number}  */
    x;

    /** @type {number}  */
    y;

    /**
     * @type {number} fScore - This score represents the best guess at how cheap the path could
     * be passing from this node `n` (from start to finish)
     */
    fScore;

    /**
     * @type {number} gScore - This score represents the current known and least expensive path traversed until this node
     */
    gScore;
}

export default GoTo;