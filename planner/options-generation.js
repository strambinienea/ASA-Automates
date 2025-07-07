import WorldState from "../belief/world-state.js";
import Logger from "../utils/logger.js";
import {findPath} from "../utils/utils.js";
import {agent} from "../coordinator.js";

async function generateOptions() {

    const options = []
    const map = WorldState.getInstance().worldMap;
    const {x: agentX, y: agentY} = await agent.getCurrentPosition();
    
    // Check if there are available parcels to pick up, if so add option to pick them up
    map.parcels.forEach(parcel => {
        if ( !parcel.carriedBy ) {
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
        const randomX = Math.floor(Math.random() * map.width);
        const randomY = Math.floor(Math.random() * map.height);
        options.push(['go_to', randomX, randomY]);
        Logger.info("No options available, added random movement option to: ", randomX, randomY);
    }

    options.forEach(option => {

        // TODO Implement parcels to ignore
        // if (option[0] === 'go_pick_up' && parcelsToIgnore.includes(option[3])) {
        //
        // } else {
        agent.push(option);
        // }
    })

    agent.sortIntentionQueue();
}

export default generateOptions;