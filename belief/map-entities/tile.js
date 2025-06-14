import TileType from "./tile-type.js";

/**
 * Class that represents a tile in the world map
 * @param { int } x - x coordinate of the tile
 * @param { int } y - y coordinate of the tile
 * @param { TileType } type - type of the tile
 */
class Tile {

    x;
    y;
    /** @type {TileType} */
    type;

    constructor() {
        this.x = null;
        this.y = null;
        this.type = TileType.OTHER;
    }

    /**
     * Check whether a tile is a valid tile, meaning the coordinates are inside the map
     * @param width - The maximum width of the map
     * @param height - The maximum height of the map
     * @return {boolean} - True if the tile is inside the map boundaries, false otherwise
     */
    isValidTile(width, height) {
        return (this.x >= 0 && this.y >= 0 && this.x < width && this.y < height);
    }

    // <== GETTERS & SETTERS ==>

    setX(x) {
        this.x = x;
        return this;
    }

    setY(y) {
        this.y = y;
        return this;
    }

    /**
     * @param {TileType} type
     * @returns {Tile}
     */
    setType(type) {
        this.type = type;
        return this;
    }
}

export default Tile;