import dotenv from "dotenv";
import cluster from "cluster";
import config from "../config.js";

dotenv.config();

const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};


// Get log level from environment variable, default to INFO
const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

class Logger {

    // Used to differentiate which thread is logging information
    static #threadContext = new Map();

    static setThreadContext(id) {
        // Store the thread context in a Map using a unique symbol for each call stack
        Logger.#threadContext.set(Symbol.for('threadContext'), id);
    }

    static getThreadContext() {
        return Logger.#threadContext.get(Symbol.for('threadContext')) || 'main';
    }

    // Serializer for object to log
    static #serializeArgs(...args) {

        // Used to set the maximum number of nested objects the logger will display
        const MAX_DEPTH = 100;
        let depth = 0;
        // Used to avoid circular dependency in logged objects
        const seen = new WeakSet();

        return args.map(arg => {
            if ( typeof arg === 'object' && arg !== null ) {
                try {
                    if ( arg instanceof Error ) {
                        return arg.stack || arg.message;
                    }
                    // Recursively stringify objects from arguments
                    return JSON.stringify(arg, (key, value) => {
                        if ( typeof value === 'object' && value !== null ) {
                            if ( value instanceof Map ) {
                                return Object.fromEntries(value);
                            }
                            if ( value instanceof Set ) {
                                return Array.from(value);
                            }
                            if ( depth > MAX_DEPTH ) {
                                return '[Max Depth Reached]';
                            }
                            depth++;
                            // Circular dependency found, stop logging
                            if ( seen.has(value) ) {
                                return '[Circular]';
                            }
                            seen.add(value);
                        }
                        return value;
                    }, 2);
                } catch (e) {
                    return `[Unserializable Object: ${e.message}]`;
                }
            }
            return String(arg);
        }).join(' ');
    }

    // Send message to the primary process in the cluster, to be logged there
    static #send(level, ...args) {
        if ( cluster.isWorker ) {
            const agentName = process.env.IS_LEADER === 'true' ? config.AGENT_NAME : config.AGENT2_NAME;
            const threadContext = Logger.getThreadContext();
            process.send({
                type: 'log',
                agentName,
                level,
                threadContext,
                data: Logger.#serializeArgs(...args)
            });
        } else {
            if ( CURRENT_LOG_LEVEL >= LOG_LEVELS[level.toUpperCase()] ) {
                console[level](Logger.#serializeArgs(...args));
            }
        }
    }

    static error(...args) {
        Logger.#send('error', ...args);
    }

    static warn(...args) {
        Logger.#send('warn', ...args);
    }

    static info(...args) {
        Logger.#send('info', ...args);
    }

    static debug(...args) {
        Logger.#send('debug', ...args);
    }

}

export default Logger;