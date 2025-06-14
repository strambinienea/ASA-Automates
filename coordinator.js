import {Agent} from "./agent/agent.js";
import cluster from "cluster";
import config from "./config.js";
import dotenv from 'dotenv';
import Logger from "./utils/logger.js";

class Coordinator {

    // Host of the Deliveroo Client
    #host;

    constructor(host) {
        this.#host = host;
    }

    startAgents() {

        if ( cluster.isPrimary ) {

            // Leader worker
            const _leaderWorker = cluster.fork({IS_LEADER: 'true'});

            // Follower worker, only if dual-mode is specified
            const _followerWorker = config.DUAL_AGENT ? cluster.fork({IS_LEADER: 'false'}) : null;

            // Handle messages from workers
            cluster.on('message', (worker, message) => {
                if ( message.type === 'log' ) {
                    const {agentName, threadContext, level, data} = message;
                    Logger[level](`[${agentName}][${threadContext}] > ${data}`);
                }
            });

            cluster.on('exit', (worker, code, signal) => {
                console.log(`Worker ${worker.process.pid} died`);
            });

        } else {
            dotenv.config();
            if ( process.env.IS_LEADER === 'true' ) {   // Spawn Leader

                // TODO MANAGE PLAN LIBRARY
                const leader = new Agent(
                    config.AGENT_ID,
                    this.#host,
                    config.TOKEN,
                    true,
                    config.DUAL_AGENT ? config.AGENT2_ID : null,
                    []
                );
                leader.loop();

            } else if ( config.DUAL_AGENT ) {           // Spawn Follower - Only in Dual-Agent mode

                // TODO MANAGE PLAN LIBRARY
                const follower = new Agent(
                    config.AGENT2_ID,
                    this.#host,
                    config.TOKEN_2,
                    false,
                    config.AGENT_ID,
                    []
                )
                follower.loop();
            }
        }
    }
}

export default Coordinator;