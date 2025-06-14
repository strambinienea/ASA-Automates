import {Agent} from "./agent/agent.js";
import {DeliverooApi} from "@unitn-asa/deliveroo-js-client";
import Logger from "./utils/logger.js";
import WorldState from "./belief/world-state.js";
import {spawn} from 'child_process';
import cluster from "cluster";
import config from "./config.js";
import dotenv from 'dotenv';

class Coordinator {

    // Host of the Deliveroo Client
    #host;

    constructor(host) {
        this.#host = host;
    }

    startAgents() {

        if ( cluster.isPrimary ) {

            // Leader worker
            const leaderWorker = cluster.fork({IS_LEADER: 'true'});

            // Follower worker, only if dual-mode is specified
            const followerWorker = config.DUAL_AGENT ? cluster.fork({IS_LEADER: 'false'}) : null;

            // Handle messages from workers
            cluster.on('message', (worker, message) => {
                if ( message.type === 'log' ) {
                    const {agentName, _level, data} = message;
                    console.log(`${agentName} > ${data}`);
                }
            });

            cluster.on('exit', (worker, code, signal) => {
                console.log(`Worker ${worker.process.pid} died`);
            });

        } else {

            // // In worker processes, override console methods, used to pass log messages from worker to main process
            // const agentName = process.env.IS_LEADER === 'true' ? config.AGENT_NAME : config.AGENT2_NAME;
            //
            // console.log = (...args) => {
            //     process.send({type: 'log', agentName, level: 'log', data: args.join(' ')});
            // };
            // console.error = (...args) => {
            //     process.send({type: 'log', agentName, level: 'error', data: args.join(' ')});
            // };
            // console.debug = (...args) => {
            //     process.send({type: 'log', agentName, level: 'debug', data: args.join(' ')});
            // };
            // console.warn = (...args) => {
            //     process.send({type: 'log', agentName, level: 'warn', data: args.join(' ')});
            // };

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


    /**
     * Spawn a single agent, to start program in single-agent mode
     * @param {AgentParameters} agentParameters - Parameter for the agent
     */
    singleAgentMode(agentParameters) {

        // Sanitize parameters
        try {
            agentParameters.sanitize()
        } catch (error) {
            Logger.error('Failed to sanitize agent parameters. Program will exit. ERROR:', error);
            process.exit(1);
        }


        // const client = new DeliverooApi(this.#host, agentParameters.token);
        // client.onConnect(() => Logger.info('Connected to Deliveroo client'));
        // client.onDisconnect(() => Logger.info('Disconnected from Deliveroo client'));
        //
        // // Assign client to update world state
        // WorldState.observerWorldState(client);
        //
        // // TODO Think about planLibrary
        // const agent = new Agent(agentParameters.id, client, true, null, []);
        //
        // // Start agent loop in a separate thread
        // new Promise(async () => {
        //     await agent.loop();
        // }).catch(error => {
        //     console.error('Error in agent thread:', error);
        // });
        //
        // return agent;
    }

    /**
     * Spawn two agents, that will communicate with each other, to start the program in dual-agent mode
     * @param {AgentParameters} leaderParameters - Parameter for the leader agent
     * @param {AgentParameters} followerParameters - Parameter for the follower agent
     */
    dualAgentMode(leaderParameters, followerParameters) {

        // Sanitize parameters
        try {
            leaderParameters.sanitize();
            followerParameters.sanitize();
        } catch (error) {
            Logger.error('Failed to sanitize one or both agent parameters. Program will exit. ERROR:', error);
            process.exit(1);
        }

        // <+++ LEADER AGENT +++>
        // TODO Think about planLibrary
        const client = new DeliverooApi(this.#host, leaderParameters.token);
        client.onConnect(() =>
            Logger.info('[CLIENT-1] Connected to Deliveroo client')
        );
        client.onDisconnect(() =>
            Logger.info('[CLIENT-1] Disconnected from Deliveroo client')
        );

        // Assign client to update world state
        WorldState.observerWorldState(client);

        const agent1 = new Agent(leaderParameters.id, client, true, followerParameters.id, []);

        // <+++ FOLLOWER AGENT +++>
        // TODO Think about planLibrary
        const client2 = new DeliverooApi(this.#host, followerParameters.token);
        client2.onConnect(() =>
            Logger.info('[CLIENT-2] Connected to Deliveroo client')
        );
        client2.onDisconnect(() =>
            Logger.info('[CLIENT-2] Disconnected from Deliveroo client')
        );

        const agent2 = new Agent(followerParameters.id, client2, false, leaderParameters.id, []);


        // Start agent1 loop in a separate thread
        new Promise(async () => {
            Logger.debug('Starting agent1: ', agent1.agentId);

            // Set the thread context for logging
            Logger.setThreadContext(agent1.agentId);
            await agent1.loop();
        }).catch(error => {
            console.error('Error in agent1 thread:', error);
        });

        // Start agent2 loop in a separate thread
        new Promise(async () => {

            Logger.debug('Starting agent2: ', agent2.agentId);

            // Set the thread context for logging
            Logger.setThreadContext(agent2.agentId);
            await agent2.loop();
        }).catch(error => {
            console.error('Error in agent2 thread:', error);
        });

        return [agent1, agent2];
    }

    #startProcess(agentParameters) {

        const childProcess = spawn();
    }
}

/**
 * Class that contains info used to spawn a new agent
 * @param {string} id - The id of the agent
 * @param {string} name - The name of the agent
 * @param {string} token - The token of the agent, to connect to the Deliveroo client
 */
class AgentParameters {
    id;
    name;
    token;

    constructor() {
        this.id = null;
        this.name = null;
        this.token = null;
    }

    /**
     * Sanitize parameters, check if any is null and act accordingly
     *  - id is null: throw exception
     *  - name is null: use AutomatesAgent + `id`
     *  - token is null: throw exception
     */
    sanitize() {

        if ( this.id === null ) {
            throw new Error('Token cannot be null');
        }

        if ( this.name === null ) {
            this.name = 'AutomatesAgent' + this.id;
        }

        if ( this.token === null || this.token === '' ) {
            throw new Error('Token cannot be null');
        }

        Logger.info('Agent parameters sanitized');
    }

    // <== GETTERS & SETTERS ==>

    setId(id) {
        this.id = id;
        return this;
    }

    setName(name) {
        this.name = name;
        return this;
    }

    setToken(token) {
        this.token = token;
        return this;
    }
}

export {Coordinator, AgentParameters};