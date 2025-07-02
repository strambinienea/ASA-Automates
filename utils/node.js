/**
 * Identifies a node, used in the path finding algorithm
 */
export class Node {

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