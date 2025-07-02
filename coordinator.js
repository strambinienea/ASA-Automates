import {Agent} from "./agent/agent.js";
import cluster from "cluster";
import config from "./config.js";
import dotenv from 'dotenv';
import Logger from "./utils/logger.js";

/** @type { Agent } */
let agent = null;

class Coordinator {

    // Host of the Deliveroo Client
    #host;

    constructor(host) {
        this.#host = host;
    }

    async startAgents() {

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

                agent = new Agent(
                    config.AGENT_ID,
                    this.#host,
                    config.TOKEN,
                    true,
                    config.DUAL_AGENT ? config.AGENT2_ID : null
                );
                agent.loop();

                await agent.push(['go_to', 1, 1]);

            } else if ( config.DUAL_AGENT ) {           // Spawn Follower - Only in Dual-Agent mode

                agent = new Agent(
                    config.AGENT2_ID,
                    this.#host,
                    config.TOKEN_2,
                    false,
                    config.AGENT_ID
                )
                agent.loop();
            }
        }
    }
}

export {Coordinator, agent};