import jwt from 'jsonwebtoken'
import WorldState from "../belief/world-state.js";
import Logger from "./logger.js";
import {Node} from "./node.js";
import {Heap} from "heap-js";
import fs from "fs";


/**
 * Decode Deliveroo JWT token to get agent information
 * @param {string} token - JWT token to decode
 * @returns {DecodedDeliverooJWT} Decoded token payload
 */
function decodeToken(token) {
    if ( !token ) return null;
    try {
        return jwt.decode(token);
    } catch (error) {
        throw new Error(`Failed to decode token: ${error.message}`);
    }
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
async function findPath(
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

function readFile(path) {
    return new Promise((res, rej) => {
        fs.readFile(path, 'utf8', (err, data) => {
            if ( err ) rej(err)
            else res(data)
        })
    })
}

/**
 * @typedef {Object} DecodedDeliverooJWT
 * @property {string} id
 * @property {string} name
 * @property {string} teamId
 * @property {string} teamName
 * @property {string} role
 * @property {number} iat
 */

export {decodeToken, readFile, findPath}