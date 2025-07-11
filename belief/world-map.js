import {Beliefset} from "@unitn-asa/pddl-client";
import Logger from "../utils/logger.js";
import WorldState from "./world-state.js";
import TileType from "./map-entities/tile-type.js";

/**
 * Class that represents the world map
 *
 */
class WorldMap {

    #width;
    #height;

    /** @type { [ Tile ] } */
    #map

    /** @type { [Tile] } */
    #depotTiles;

    /** @type { [Tile] } */
    #spawnTiles;

    /** @type { [Parcel] } */
    #parcels;

    /** @type { [AdversaryAgent] } */
    #adversaryAgents;

    /** @type {{ x: number, y: number }} */
    #leaderPosition;

    /** @type {{ x: number, y: number }} */
    #followerPosition;

    /** @type { Beliefset } */
    #beliefSet;

    constructor() {
        this.#width = null;
        this.#height = null;
        this.#map = [];
        this.#depotTiles = [];
        this.#spawnTiles = [];
        this.#parcels = [];
        this.#adversaryAgents = []
        this.#beliefSet = new Beliefset();
    }

    /**
     * Update a single tile in the map
     * @param { Tile } tile - The new tile
     */
    updateTile(tile) {

        if ( tile.isValidTile(this.#width, this.#height) ) {
            this.#map[tile.y * this.#width + tile.x] = tile;
        } else {
            Logger.error(
                'Tile is not valid, probably outside the map boundaries. Tile: ', tile,
                'Map width: ', this.#width, 'Map height: ', this.#height);
        }
    }

    /**
     * Update parcels spotted by the agent, add new perceived parcels and remove expired one
     * @param { [Parcel] } parcels - List of new parcels to add
     * @param timestamp - Used to find expired parcels, and remove them from the list
     */
    updateParcels(parcels, timestamp) {

        /** @type { WorldState } */
        const worldState = WorldState.getInstance();

        // Remove expired parcels
        this.#parcels = this.#parcels
            .filter(p => !p.isExpired(timestamp, worldState.PARCEL_DECADING_INTERVAL));

        // For every new parcel, check if a parcel with the same id exists, if so keep the parcel with the newest
        parcels.forEach(newParcel => {

            let currentParcel = this.#parcels.find(parcel => parcel.id === newParcel.id)
            if ( currentParcel ) {
                // If current parcel is older than new one, then substitute it
                if ( currentParcel.timestamp < newParcel.timestamp ) {
                    Logger.debug('Two parcels with same id found, replacing older one with new one: ', newParcel);
                    this.#parcels.splice(this.#parcels.indexOf(currentParcel), 1, newParcel);
                }
            } else {
                Logger.debug('Inserting new parcel: ', newParcel);
                this.#parcels.push(newParcel);
            }
        })
    }

    /**
     * Update adversary agents spotted by the agent
     * @param { [AdversaryAgent] } adversaryAgents - List of perceived adversary agents
     */
    updateAdversaryAgents(adversaryAgents) {

        adversaryAgents.forEach(adversaryAgent => {

            // Find if an agent with same id already exists in current list, if so update the position with the new one
            let currentAgent = this.#adversaryAgents
                .find(agent => agent.id === adversaryAgent.id);

            if ( currentAgent ) {
                // If current agent is older than new one, then update it's position
                if ( currentAgent.timestamp < adversaryAgent.timestamp ) {
                    Logger.debug(
                        'Two adversary agents with same id found, updating position of older one with new one: ',
                        adversaryAgent
                    );
                    this.#adversaryAgents.splice(this.#adversaryAgents.indexOf(currentAgent), 1, adversaryAgent);
                }
            } else {
                Logger.debug('Inserting new adversary agent: ', adversaryAgent);
                this.#adversaryAgents.push(adversaryAgent);
            }
        })
    }

    /**
     * Update the belief set used by agents while planning.
     */
    updateBeliefSet() {

        this.#beliefSet = new Beliefset();
        // Consider only walkable tiles
        this.#map
            .filter(t => t.type === TileType.DEPOT || t.type === TileType.SPAWN || t.type === TileType.OTHER)
            .forEach(({x, y, _type}) => {

                // Check if an agent currently occupies the tile
                const isOccupied = this.#adversaryAgents.some(agent => agent.y === y && agent.x === x);
                if ( !isOccupied ) {
                    // Fill belief set with information about the tiles in the map
                    // Used for PDDL, fill predicate about tile position with respect to one another
                    // For each direction check if tile is inside map boundaries

                    // Find upward tile -> current tile is below
                    if ( y + 1 < this.#height ) {
                        this.#beliefSet.declare("below tile" + x + "_" + y + " tile" + x + "_" + (y + 1));
                    }

                    // Find downward tile -> current tile is above
                    if ( y - 1 >= 0 ) {
                        this.#beliefSet.declare("above tile" + x + "_" + y + " tile" + x + "_" + (y - 1));
                    }

                    // Find right tile -> current tile is to the left
                    if ( x + 1 < this.#width ) {
                        this.#beliefSet.declare("left tile" + x + "_" + y + " tile" + (x + 1) + "_" + y);
                    }

                    // Find left tile -> current tile is to the right
                    if ( x - 1 >= 0 ) {
                        this.#beliefSet.declare("right tile" + x + "_" + y + " tile" + (x - 1) + "_" + y);
                    }
                } else {
                    Logger.debug('Tile [', x, ', ', y, '] is occupied, not filling belief set');
                }
            })
    }

    // <== GETTERS & SETTERS ==>

    get width() {
        return this.#width;
    }

    get height() {
        return this.#height;
    }

    get beliefSet() {
        return this.#beliefSet;
    }

    get parcels() {
        return this.#parcels;
    }

    /**
     * Remove a parcel from the map, used when a parcel is picked up by an agent
     * @param parcelId { string } - Id of the parcel to remove
     */
    parcelPickedUp(parcelId) {

        Logger.debug('Removing parcel with id: ', parcelId, ' from the map');
        this.#parcels = this.#parcels.filter(p => p.id !== parcelId);
    }

    get depotTiles() {
        return this.#depotTiles;
    }

    setWidth(width) {
        this.#width = width;
        return this;
    }

    setHeight(height) {
        this.#height = height;
        return this;
    }

    /** @param { [Tile] } map */
    setMap(map) {
        this.#map = map;
        return this;
    }

    /** @param { [Tile] } depotTiles */
    setDepotTiles(depotTiles) {
        this.#depotTiles = depotTiles;
        return this;
    }

    /** @param { [Tile] } spawnTiles */
    setSpawnTiles(spawnTiles) {
        this.#spawnTiles = spawnTiles;
        return this;
    }

    /**
     * @param { number } x
     * @param { number } y
     */
    setLeaderPosition(x, y) {
        this.#leaderPosition = {x, y};
        return this;
    }

    /**
     * @param { number } x
     * @param { number } y
     */
    setFollowerPosition(x, y) {
        this.#followerPosition = {x, y};
        return this;
    }

    get followerPosition() {
        return this.#followerPosition;
    }

    get leaderPosition() {
        return this.#leaderPosition;
    }

    /**
     * Get walkable tiles from the map
     * @param {boolean} withAgents - If true than agents will not be considered as obstacles. Default `false`
     * @return { Promise<[Tile]> } Walkable tiles
     */
    async getWalkableTiles(withAgents = false) {

        // Wait for the map to be populated
        while ( this.#map.length === 0 ) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        let walkableTiles = this.#map
            .filter(t => {
                return t.type === TileType.DEPOT || t.type === TileType.SPAWN || t.type === TileType.OTHER
            });

        // Filter tiles where agents have been spotted, also filter follower tile
        if ( !withAgents ) {
            walkableTiles = walkableTiles
                .filter(t => !this.#adversaryAgents.some(agent => agent.y === t.y && agent.x === t.x))
                .filter(t => {
                    if ( this.#followerPosition ) {
                        return !(t.x === this.#followerPosition.x && t.y === this.#followerPosition.y);
                    }
                    return true;
                });
        }

        return walkableTiles;
    }

    /**
     * Return neighboring tiles for a given tile position
     * @param { {x: number, y: number} } tile - The tile coordinate
     * @param {boolean} walkable - If true, then only walkable neighboring tiles will be considered. Default `true`
     */
    async getNeighborTiles(tile, walkable = true) {

        let neighbors = [
            {x: tile.x - 1, y: tile.y},
            {x: tile.x + 1, y: tile.y},
            {x: tile.x, y: tile.y - 1},
            {x: tile.x, y: tile.y + 1}
        ]

        // Check if neighbors coordinate are inside map border
        neighbors = neighbors.filter(t => t.x >= 0 && t.x < this.#width && t.y >= 0 && t.y < this.#height)

        // If walkable then filter the neighbors by checking if they are walkable tiles,
        // also considers tiles with other agents as non-walkable tiles.
        if ( walkable ) {
            const walkableTiles = await this.getWalkableTiles()
            neighbors = neighbors.filter(t => walkableTiles.some(wt => wt.x === t.x && wt.y === t.y)
            )
        }

        return neighbors;
    }

    /**
     * Return depot tiles asynchronously. Wait until depotTiles list is populated.
     * @return {Promise<Tile[]>} The list of depot tiles
     */
    async getDepotTilesAsync() {

        while ( this.#depotTiles.length === 0 ) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return this.#depotTiles;
    }

    /**
     * Return spawn tiles asynchronously. Wait until spawnTiles list is populated.
     * @return {Promise<Tile[]>} The list of depot tiles
     */
    async getSpawnTilesAsync() {

        while ( this.#spawnTiles.length === 0 ) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return this.#spawnTiles;
    }
}


export default WorldMap;