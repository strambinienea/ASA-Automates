import {AgentParameters, Coordinator} from "./coordinator.js";
import Logger from "./utils/logger.js";
import config from "./config.js";

const coordinator = new Coordinator(config.HOST);

if ( config.DUAL_AGENT ) { // DUAL AGENT MODE

    Logger.info('Running dual-agent mode');

    // Agent 1 config
    // const agent1Parameters = new AgentParameters()
    //     .setId(config.AGENT_ID)
    //     .setName(config.AGENT_NAME)
    //     .setToken(config.TOKEN);
    //
    // // Agent 2 config
    // const agent2Parameters = new AgentParameters()
    //     .setId(config.AGENT2_ID)
    //     .setName(config.AGENT2_NAME)
    //     .setToken(config.TOKEN_2);

    // const [agent1, agent2] = coordinator.dualAgentMode(agent1Parameters, agent2Parameters);

    coordinator.startAgents();
} else { // SINGLE AGENT MODE
    Logger.info('Running single-agent mode');

    const params = new AgentParameters()
        .setId(config.AGENT_ID)
        .setName(config.AGENT_NAME)
        .setToken(config.TOKEN);

    const agent = coordinator.singleAgentMode(params);
}