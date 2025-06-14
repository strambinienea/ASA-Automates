import WorldMap from "./world-map.js"
import Tile from "./map-entities/tile.js";
import TileType from "./map-entities/tile-type.js";
import Parcel from "./map-entities/parcel.js";
import AdversaryAgent from "./map-entities/adversary-agent.js";
import {DeliverooApi} from "@unitn-asa/deliveroo-js-client";
import Logger from "../utils/logger.js";
import config from "../config.js";

/**
 * Used to update the world state, with parcels position, other agents positions, etc
 */
class WorldState {

    static #instance = null;

    #worldMap;

    // World Config
    #PARCEL_DECADING_INTERVAL = null;
    #PARCELS_OBSERVATION_DISTANCE = null;
    #PARCEL_REWARD_AVG = null;
    #PARCEL_REWARD_VARIANCE = null;

    constructor() {
        this.#worldMap = new WorldMap();
    }

    /**
     * Observe the world state using the leader client (also uses follower client to gain more information).
     * Update lists with information regarding all entities on the map.
     * @param { DeliverooApi } client - The client of the leader agent
     * @param { DeliverooApi } followerClient - The client of the follower agent
     */
    static observerWorldState(client, followerClient = null) {
        const instance = WorldState.getInstance();

        // Collect information about the environment configurations
        client.onConfig((config) => {
            Logger.debug('Obtaining information about the environment configurations');

            instance.#PARCEL_DECADING_INTERVAL = config.PARCEL_DECADING_INTERVAL;
            instance.#PARCELS_OBSERVATION_DISTANCE = config.PARCELS_OBSERVATION_DISTANCE;
            instance.#PARCEL_REWARD_AVG = config.PARCEL_REWARD_AVG;
            instance.#PARCEL_REWARD_VARIANCE = config.PARCEL_REWARD_VARIANCE;

            Logger.debug(
                'Obtained configuration: \n',
                '\tPARCEL_DECADING_INTERVAL: ', instance.#PARCEL_DECADING_INTERVAL, '\n',
                '\tPARCELS_OBSERVATION_DISTANCE: ', instance.#PARCELS_OBSERVATION_DISTANCE, '\n',
                '\tPARCEL_REWARD_AVG: ', instance.#PARCEL_REWARD_AVG, '\n',
                '\tPARCEL_REWARD_VARIANCE: ', instance.#PARCEL_REWARD_VARIANCE, '\n'
            );
        });

        // Populate map with initial information
        client.onMap((width, height, rawTiles) => {
            Logger.debug('Populating map with initial information');

            let tiles = [];
            let deoptTiles = [];
            let spawnTiles = [];

            for ( let y = 0; y < height; y++ ) {
                tiles[y] = []; // Initialize the row array
                for ( let x = 0; x < width; x++ ) {
                    const tile = new Tile()
                        .setX(x)
                        .setY(y);

                    switch ( rawTiles[y * width + x].type ) {
                        case 0: {
                            tile.setType(TileType.WALL);
                            break;
                        }
                        case 1: {
                            tile.setType(TileType.SPAWN);
                            spawnTiles.push(tile);
                            break;
                        }
                        case 2: {
                            tile.setType(TileType.DEPOT);
                            deoptTiles.push(tile);
                            break;
                        }
                        case 3: {
                            tile.setType(TileType.OTHER);
                            break;
                        }
                        default: {
                            throw new Error('Unknown tile type: ' + rawTiles[y][x]);
                        }
                    }

                    tiles[y][x] = tile;
                }
            }

            instance.#worldMap
                .setWidth(width)
                .setHeight(height)
                .setMap(tiles)
                .setSpawnTiles(spawnTiles)
                .setDepotTiles(deoptTiles);
        });

        // Update map with parcels information
        client.onParcelsSensing((perceivedParcels) => instance.#onParcelsSensed(perceivedParcels));

        // Use follower to spot other parcels
        if ( followerClient ) {
            followerClient
                .onParcelsSensing((perceivedParcels) => instance.#onParcelsSensed(perceivedParcels));
        }

        // Update map with other agents information
        client.onAgentsSensing((agents) => instance.#onAgentsSensed(agents));

    }

    /**
     * Callback for the onParcelsSensing client event, updates the list of sensed parcels in the map
     * @param perceivedParcels - List of perceived parcels passed by the client
     */
    #onParcelsSensed(perceivedParcels) {
        Logger.debug('Populating map with parcels information');

        const timestamp = Date.now();
        let parcels = [];
        perceivedParcels.forEach(p => {

            // If parcel is not carried by anyone add it to the list
            if ( !p.carriedBy ) {
                const parcel = new Parcel();
                parcel
                    .setX(p.x)
                    .setY(p.y)
                    .setParcelId(p.id)
                    .setReward(p.reward)
                    .setTimestamp(timestamp);

                parcels.push(parcel);
            }
        })

        this.#worldMap.updateParcels(parcels, timestamp);

        Logger.debug('New parcels populated');
    }

    /**
     * Callback for the onAgentsSensing client event, updates the list of sensed agents in the map
     * @param perceivedAgents - List of perceived agents passed by the client
     */
    #onAgentsSensed(perceivedAgents) {
        Logger.debug('Populating map with agents information');

        const timestamp = Date.now();
        let agents = [];
        perceivedAgents.forEach(a => {
            // Check whether the agent is an adversary or one of ours
            if ( !(a.id === config.AGENT_ID || a.id === config.AGENT2_ID) ) {

                Logger.debug("Agent: ", a.id, " is an adversary, updating map with its position")
                const agent = new AdversaryAgent();
                agent
                    .setX(a.x)
                    .setY(a.y)
                    .setId(a.id)
                    .setTimestamp(timestamp);

                agents.push(agent);
            } else {
                Logger.debug("Agent: ", a.id, " is one of ours")

                // Update position of the agent in the map
                if ( a.id === config.AGENT_ID ) {
                    this.#worldMap.setLeaderPosition(a.x, a.y);
                } else if ( a.id === config.AGENT2_ID ) {
                    this.#worldMap.setFollowerPosition(a.x, a.y);
                }
            }
        })

        this.#worldMap.updateAdversaryAgents(agents);
        Logger.debug('New agents populated');
    }

    // <== GETTERS & SETTERS ==>

    get worldMap() {
        return this.#worldMap;
    }

    get PARCEL_DECADING_INTERVAL() {
        return this.#PARCEL_DECADING_INTERVAL;
    }

    get PARCELS_OBSERVATION_DISTANCE() {
        return this.#PARCELS_OBSERVATION_DISTANCE;
    }

    get PARCEL_REWARD_AVG() {
        return this.#PARCEL_REWARD_AVG;
    }

    get PARCEL_REWARD_VARIANCE() {
        return this.#PARCEL_REWARD_VARIANCE;
    }

    static getInstance() {
        if ( !WorldState.#instance ) {
            WorldState.#instance = new WorldState();
        }
        return WorldState.#instance;
    }
}

export default WorldState;