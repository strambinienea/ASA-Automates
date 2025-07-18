# Automates Agent

Repository containing the agent for the course Autonomous Software Agents (UniTN 2024/2025).

The agent is designed to autonomously navigate a map, collect resources and deliver them to specific locations,
either alone or in collaboration with a 'follower' agent.

## Starting the Agent

1. After cloning the repository, the first step is to install the necessary dependencies.
   This can be done by running this command in the root directory of the project:
   ```sh
   npm install
   ```
2. Once the dependencies are installed, some environment variables need to be set.
   This can be done by creating a `.env` file in the root directory of the project.
   The `.env` file should contain the following variables:
   ```env
    HOST= <host-URL>
    DUAL_AGENT=false
    TOKEN= <Token-1>
    TOKEN_2= <Token-2>
   ```
   Replace `<host-URL>` with the URL of the server where the agent will connect, and `<Token-1>` and `<Token-2>` with
   the tokens for the agent and follower, respectively. The `DUAL_AGENT` variable decide whether only one agent will be
   spawned or two agents will be spawned, one as a leader and one as a follower.

> **NOTE**: `TOKEN_2` is only required if `DUAL_AGENT` is set to `true`. Additional environment variables can be set
> in the `.env` file as needed, as shown later in the documentation.

3. After setting the environment variables, the agent can be started by running the following command:
   ```sh
   npm start
   ```

## Repository Structure

This is a simplified overview of the repository structure:

```
.
├── agent/
│   ├── intention.js
│   └── agent.js
├── belief/
│   ├── map-entities/
│   ├── world-map.js
│   └── world-state.js
├── planner/
│   ├── plans/
│   └── options-generation.js
├── utils/
├── config.js
├── coordinator.js
└── index.js
```

- `agent/`: Contains the `agent.js` file, with the main agent logic and intention review, and `intention.js`,
  which defines an abstract intention class.
- `belief/`: Contains everything related to the agent's belief system, including the `world-map.js` file, which stores
  information about the map the agents navigate, and the `world-state.js` file, which contains the logic used to
  update the map information and agent beliefs. Inside `map-entities/`, there are classes representing the different
  entities that can be found on the map, such as different tile types, other agents, etc...
- `planner/`: Contains the `options-generation.js` file, which is responsible for generating the options available to
  the agent, and the `plans/` directory, which contains the different plans that the agent can execute to achieve
  intentions.

> **NOTE**: Different plans can be used, modifying the `PLAN_LIBRARY` variable in the `config.js` file.

- `utils/`: Contains utility functions used throughout the agent. Contains the `logger.js` file, which is used to
  log messages to the console.

## Special Case - Single Corridor Map

In the case of a single corridor map, when `DUAL_AGENT` mode is active, the agents will automatically switch to a
special mode called `Hand2Hand`. This is done because agents will block each other path, either when delivering or
collecting a parcel. Each agent will check if they are able to reach a depot or a spawn tile; in case they are not able
to do that they will enter a special mode, either `GATHER` or `DELIVER`, depending if the agent can reach a spawn
or depot respectively. Through a message the other agent will be informed about the intention of the agent, and will
fulfill the missing role.

> **NOTE**: If an agent is not able to fulfill a role received in the message, it will throw an error and crash.

Each role has a different function that generates options.

#### DELIVER

The `DELIVER` agent will stay at the depot, waiting for parcels to be delivered. At the beginning it will define a
common delivery area, a tile which should be reachable by both agents, and will communicate it to the other agent via a
message. It will then wait for the other agent to deliver parcels, and will collect them when they are available.

#### GATHER

The `GATHER` agent will roam the map, looking for parcels to collect. It will collect them and deliver them to the
delivery area received by the other agent. If no parcel is present to be gather it will move to one of the spawn points
in the map, waiting for a new parcel to be spawned.

## Environment Variables

The agent can be configured using environment variables. The following variables are available:

| Variable                     | Required | Default                 | Description                                                                                                                                                                 |
|------------------------------|----------|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| HOST                         | Yes      | -                       | URL of the server where the agent will connect                                                                                                                              |
| DUAL_AGENT                   | No       | false                   | When true, spawns two agents (leader and follower)                                                                                                                          |
| TOKEN                        | Yes      | -                       | Authentication token for the leader agent                                                                                                                                   |
| TOKEN_2                      | Yes*     | -                       | Authentication token for the follower agent (*required if DUAL_AGENT=true)                                                                                                  |
| OPTION_GENERATION_INTERVAL   | No       | 50                      | Fixed interval (in ms) for generating options                                                                                                                               |
| MAX_CARRIED_PARCELS          | No       | 6                       | Maximum number of parcels that can be carried by the agent  before it only considers drop-off instructions.                                                                 |
| MAX_DISTANCE_FOR_RANDOM_MOVE | No       | 10                      | Maximum distance from the agent to a tile, when the agent considers a random move. If no spawn tile is inside this range, the agent will consider all spawn tile in the map |
| MAX_RETRY_COMMON_DELIVERY    | No       | 10                      | **NOT USED!** The maximum number of retries a DELIVER Agent can do while searching for a common delivery tile before throwing an exception.                                 |
| DOMAIN_FILE_PATH             | No       | "./belief/domain.pddl"  | Path of the domain file used for the PDDL movement                                                                                                                          |
| PROBLEM_FILE_PATH            | No       | "./belief/problem.pddl" | Path where the problem.pddl will be save, used for debugging.                                                                                                               |
| LOG_LEVEL                    | No       | INFO                    | Logging level (ERROR, WARN, INFO, DEBUG)                                                                                                                                    |
