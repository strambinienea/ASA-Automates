import Tile from "./tile.js";
import TileType from "./tile-type.js";

/**
 * Class that represent an adversary agent in the map
 * @param { number } id - Id of the agent
 * @param { number } timestamp - Timestamp of when the agent was perceived
 */
class AdversaryAgent extends Tile {

    id;
    timestamp;


    constructor(props) {
        super(props);
        super.type = TileType.ADVERSARY_AGENT;
        this.id = null;
        this.timestamp = null;
    }

    setId(id) {
        this.id = id;
        return this;
    }

    setTimestamp(timestamp) {
        this.timestamp = timestamp;
        return this;
    }
}

export default AdversaryAgent;