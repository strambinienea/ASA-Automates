import {Coordinator} from "./coordinator.js";
import config from "./config.js";

const coordinator = new Coordinator(config.HOST);

await coordinator.startAgents();