import Tile from "./tile.js";
import TileType from "./tile-type.js";
import Logger from "../../utils/logger.js";

/**
 * Class that represents a parcel in the map
 * @param { int } id - The parcel's id
 * @param { int } reward - Reward obtained when delivering the parcel
 * @param { number } timestamp - Timestamp when the parcel has been perceived
 */
class Parcel extends Tile {

    id;
    reward;
    timestamp;
    carriedBy;

    constructor() {
        super();
        super.setType(TileType.PARCEL);
        this.id = null;
        this.reward = null;
        this.timestamp = null;
        this.carriedBy = null;
    }

    /**
     * Check whether a parcel is expired, to do so it estimates the current reward, if it's below a given threshold,
     * then it's considered expired
     * @param timestamp - The current timestamp, used to find how much time is passed since the parcel was perceived
     * @param PARCEL_DECADING_INTERVAL - The interval at which the reward of a parcel is decreased
     * @returns {boolean} - True if the parcel is expired, false otherwise
     */
    isExpired(timestamp, PARCEL_DECADING_INTERVAL) {

        // TODO Once global config class is done, insert reward threshold for expired parcels
        // Find the points decayed since the parcel was first spotted, if it's below zero then the parcel has expired
        const timeDelta = (timestamp - this.timestamp) / 1000; // Convert milliseconds to seconds
        const pointsDecayed = Math.floor(timeDelta / PARCEL_DECADING_INTERVAL);

        return this.reward - pointsDecayed < 0;
    }

    setParcelId(id) {
        this.id = id;
        return this;
    }

    setReward(reward) {
        this.reward = reward;
        return this;
    }

    setTimestamp(timestamp) {
        this.timestamp = timestamp;
        return this;
    }

    setCarriedBy(agentId) {
        this.carriedBy = agentId;
        return this;
    }

    get CarriedBy() {
        return this.carriedBy;
    }
}

export default Parcel;