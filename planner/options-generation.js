import WorldState from "../belief/world-state.js";
import Logger from "../utils/logger.js";
import {findPath} from "../utils/utils.js";
import {agent} from "../coordinator.js";
import {Hand2HandBehaviour} from "../agent/agent.js";
import Config from "../config.js";
import {config} from "dotenv";

/**
 * Global variable containing tiles to avoid when searching for a common delivery tile (hand2hand status).
 * @type {[Tile]}
 */
let TILES_TO_AVOID = [];

async function generateOptions() {

    switch ( agent.hand2HandMode ) {

        case Hand2HandBehaviour.NONE : {
            Logger.debug("Generating options for Normal behavior");

            await generateOptionNormalBehavior()
            break
        }

        case Hand2HandBehaviour.DELIVER : {
            Logger.debug("Generating options for Deliver behavior");

            await generateOptionDeliverBehavior()
            break
        }

        case Hand2HandBehaviour.GATHER : {
            Logger.debug("Generating options for Gather behavior");

            await generateOptionGatherBehavior()
            break
        }

        default : {
            throw new Error("Unexpected agent behavior " + agent.hand2HandMode);
        }
    }
}

/**
 * Generate options for the agent to perform actions based on the current world state.
 * This function is used when the state of the agent(s) is normal behavior, and not hand2hand.
 */
async function generateOptionNormalBehavior() {


    const options = []
    const map = WorldState.getInstance().worldMap;
    const {x: agentX, y: agentY} = await agent.getCurrentPosition();

    // Check if there are available parcels to pick up, if so add option to pick them up
    map.parcels.forEach(parcel => {
        if ( canPickUp(parcel) && !agent.parcelsToIgnore.includes(parcel.id) ) {
            options.push(["go_pick_up", parcel.x, parcel.y, parcel.id]);
            Logger.debug("Option to pick up parcel: ", parcel.id, " at position: ", parcel.x, parcel.y, " pushed.");
        }
    })

    // If agent is carrying a parcel, add option to deliver it to the closest depot.
    // Uses the findPath utility to find the distance, via A* algorithm.
    if ( agent.carryingParcel ) {

        const depots = map.depotTiles;
        /** @type { Tile } */
        let closestDepot = null;
        let minDistance = Infinity;

        for ( const depot of depots ) {
            const path = await findPath({x: agentX, y: agentY}, {x: depot.x, y: depot.y});

            if ( path != null && path.length < minDistance ) {
                minDistance = path.length;
                closestDepot = depot;
            }
        }

        if ( closestDepot ) {
            options.push(['go_drop_off', closestDepot.x, closestDepot.y])
            Logger.debug("Option to deposit parcels to depot: ", closestDepot.x, closestDepot.y, " pushed.");
        }
    }

    // If no options are available, add a random movement option
    if ( options.length === 0 ) {

        Logger.info("No options available, move closer to one of the spawn point");

        // Get the spawn tiles from the map, first filter them based on Euclidean distance
        // This step is necessary to avoid slow performance in big maps,
        // as we only want to consider tiles that are within a reasonable distance from the agent.
        const spawn = await map.getSpawnTilesAsync()
            .then(res => res.filter(
                    tile => Math.abs(tile.x - agentX) <= Config.MAX_DISTANCE_FOR_RANDOM_MOVE &&
                        Math.abs(tile.y - agentY) <= Config.MAX_DISTANCE_FOR_RANDOM_MOVE
                )
            )

        let closestTiles = [];
        if ( spawn.length === 0 ) {

            // No target was found with Euclidean distance in range of MAX_DISTANCE_FOR_RANDOM_MOVE,
            // so we will consider all spawn tiles. No further filtering will be done, since we already proved tiles
            // are out of reach from the agent.
            closestTiles = await map.getSpawnTilesAsync();

        } else {

            // Further filter tiles using A* pathfinding to ensure they are both reachable and to consider
            // the actual distance to the agent.
            for ( const spawnTile of spawn ) {
                const path = await findPath({x: agentX, y: agentY}, {x: spawnTile.x, y: spawnTile.y});
                if ( path != null && path.length <= Config.MAX_DISTANCE_FOR_RANDOM_MOVE ) {
                    closestTiles.push(spawnTile);
                }
            }
        }

        // Pick a random tile from the closest tiles, or from the spawn tiles if no closest tiles are found
        const randomTile = closestTiles.length > 0 ?
            closestTiles[Math.floor(Math.random() * closestTiles.length)] :
            spawn[Math.floor(Math.random() * spawn.length)];

        options.push(['go_to', randomTile.x, randomTile.y]);
    }

    options.forEach(option => agent.push(option))
    await agent.sortIntentionQueue();
}

/**
 * Generate options for the agent with GATHER Hand2Hand behavior.
 */
async function generateOptionGatherBehavior() {

    const options = []
    const map = WorldState.getInstance().worldMap;

    if ( agent.deliveryTile != null ) {

        // Check if there are available parcels to pick up, if so add option to pick them up
        // Avoid picking up parcels that are on the common delivery tile.

        map.parcels.forEach(parcel => {
            if ( canPickUp(parcel) && (parcel.x !== agent.deliveryTile.x || parcel.y !== agent.deliveryTile.y) ) {
                options.push(["go_pick_up", parcel.x, parcel.y, parcel.id]);
                Logger.debug("Option to pick up parcel: ", parcel.id, " at position: ", parcel.x, parcel.y, " pushed.");
            }
        })

        // If agent is carrying a parcel, add option to deliver it to the common delivery tile.
        if ( agent.carryingParcel ) {
            options.push(['go_drop_off', agent.deliveryTile.x, agent.deliveryTile.y]);
        } else if ( options.length === 0 ) {
            // If no options are available, move to spawn of parcels
            Logger.debug("No options available, moving to spawn tile.");
            const spawn = await map.getSpawnTilesAsync();
            options.push(['go_to', spawn[0].x, spawn[0].y]);
        }
    }

    options.forEach(option => {

        if ( option[0] === 'go_pick_up' && agent.parcelsToIgnore.includes(option[3]) ) {
            Logger.debug("Ignoring option to pick up parcel: ", option[3], " as it is in the ignore list.");
        } else {
            agent.push(option);
        }
    })

    await agent.sortIntentionQueue();
}

/**
 * Generate options for the agent with DELIVER Hand2Hand behavior.
 */
async function generateOptionDeliverBehavior() {

    const options = []
    const map = WorldState.getInstance().worldMap;
    const {x: agentX, y: agentY} = await agent.getCurrentPosition();
    let deliveryTileRetryCounter = 0;

    // Move the agent to the depot if not carrying a parcel and not already at the depot.
    if ( !agent.carryingParcel && (agentX !== agent.depot.x || agentY !== agent.depot.y) ) {
        options.push(['go_to', agent.depot.x, agent.depot.y]);
    }

    // Initialize the hand2hand mode, find a common delivery tile if not already set
    if ( agent.deliveryTile === null && deliveryTileRetryCounter < Config.MAX_RETRY_COMMON_DELIVERY ) {

        TILES_TO_AVOID.push(agent.depot);

        const deliveryTile = await findCommonDeliveryTile(
            map,
            {x: agent.depot.x, y: agent.depot.y},
            await map.getNeighborTiles(agent.depot),
        )

        if ( deliveryTile != null ) {
            Logger.info("Common delivery tile found", deliveryTile);
            agent.deliveryTile = deliveryTile;

            /** @type { DeliveryTileMessage } */
            const message = {
                action: 'delivery_tile',
                status: 'set',
                tile: {
                    x: deliveryTile.x,
                    y: deliveryTile.y
                }
            }

            // Send message to other agent with the delivery tile
            await agent.sendMessageToCompanion(message);
        } else {
            deliveryTileRetryCounter++;
        }
    }

    // Check if there are available parcels to pick up at the common delivery tile,
    map.parcels.forEach(parcel => {
        if ( canPickUp(parcel) && parcel.x === agent.deliveryTile.x && parcel.y === agent.deliveryTile.y ) {
            options.push(["go_pick_up", parcel.x, parcel.y, parcel.id]);
            Logger.debug("Option to pick up parcel: ", parcel.id, " at position: ", parcel.x, parcel.y, " pushed.");
        }
    })

    // If agent is carrying a parcel, add option to deliver it to the reachable depot.
    if ( agent.carryingParcel ) {
        options.push(['go_drop_off', agent.depot.x, agent.depot.y]);
    }

    options.forEach(option => {

        if ( option[0] === 'go_pick_up' && agent.parcelsToIgnore.includes(option[3]) ) {
            Logger.debug("Ignoring option to pick up parcel: ", option[3], " as it is in the ignore list.");
        } else {
            agent.push(option);
        }
    })

    await agent.sortIntentionQueue();

}

/**
 *
 * @param map { WorldMap }
 * @param agentPosition { {x: number, y: number} }
 * @param tilesToCheck { [Tile] }
 * @return {Promise<Tile>}
 */
async function findCommonDeliveryTile(
    map,
    agentPosition,
    tilesToCheck
) {

    // Take the first tile in the list
    const deliveryTile = tilesToCheck.shift();

    if ( !deliveryTile ) {
        Logger.warn("No common delivery tile found, will retry later");
        return null;
    }

    // If the tile is not in the avoid list
    if ( !TILES_TO_AVOID.some(t => t.x === deliveryTile.x && t.y === deliveryTile.y) ) {
        // If the tile is reachable by both agents
        if ( await findPath(agentPosition, deliveryTile) != null ) {

            // Then return the tile
            return deliveryTile;
        }
    }

    TILES_TO_AVOID.push(deliveryTile)

    Logger.debug("TILES-TO-AVOID", TILES_TO_AVOID);

    let neighbors = await map.getNeighborTiles(deliveryTile);
    neighbors = neighbors.filter(tile => !TILES_TO_AVOID.some(t => t.x === tile.x && t.y === tile.y));

    // If tile is not the right one, the add the neighbor of the tile to the list of the tiles to check,
    // add the tile to the list of tiles to avoid, to prevent it from being checked again, and call the function recursively
    return findCommonDeliveryTile(
        map,
        agentPosition,
        [...tilesToCheck, ...neighbors]
    );
}

/**
 * Function that checks if the parcel can be picked up by an agent.
 * @param parcel { Parcel } the parcel to check
 * @return {boolean} true if the parcel can be picked up, false otherwise
 */
function canPickUp(parcel) {
    return !parcel.carriedBy && parcel.x != null && parcel.y != null;
}

export default generateOptions;