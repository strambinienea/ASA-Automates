import dotenv from 'dotenv';
import {decodeToken} from "./utils/utils.js";
import GoTo from "./planner/plans/go-to.js";
import GoPickUp from "./planner/plans/go-pick-up.js";
import GoDropOff from "./planner/plans/go-drop-off.js";

/**
 * Config class, gathering information from ENV variables
 */
class Config {

    async init() {
        dotenv.config();

        /** @type string */
        this.HOST = process.env.HOST ?? (() => {
            throw new Error('HOST not defined');
        })();

        /** @type boolean */
        this.DUAL_AGENT = process.env.DUAL_AGENT === 'true';

        /** @type [Plan] */
        this.PLAN_LIBRARY = [GoTo, GoPickUp, GoDropOff];

        /**
         * Fixed interval (in ms) for generating options.
         * @type number
         */
        this.OPTION_GENERATION_INTERVAL = parseInt(process.env.OPTION_GENERATION_INTERVAL) || 200;

        // <+++ LEADER +++>
        /** @type string */
        this.TOKEN = process.env.TOKEN ?? (() => {
            throw new Error('TOKEN not defined')
        })();

        const decodedLeaderToken = decodeToken(this.TOKEN);

        /** @type string */
        this.AGENT_ID = decodedLeaderToken.id;

        /** @type string */
        this.AGENT_NAME = decodedLeaderToken.name;

        /**
         * The maximum number of parcels that can be carried by the agent before it only considers drop-off instructions.
         * @type number
         * */
        this.MAX_CARRIED_PARCELS = parseInt(process.env.MAX_CARRIED_PARCELS) || 4;

        // <+++ FOLLOWER +++>

        if ( this.DUAL_AGENT ) {
            /** @type string */
            this.TOKEN_2 = process.env.TOKEN_2 ?? (() => {
                throw new Error('TOKEN_2 not defined in dual mode')
            })();

            const decodedFollowerToken = decodeToken(this.TOKEN_2);

            /** @type string */
            this.AGENT2_ID = decodedFollowerToken.id;

            /** @type string */
            this.AGENT2_NAME = decodedFollowerToken.name;
        }
    }
}

let config = new Config();
await config.init();

export default config;

