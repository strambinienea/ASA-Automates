import {DeliverooApi} from "@unitn-asa/deliveroo-js-client";
import dotenv from "dotenv";

const INTENTION_QUEUE_SIZE = 3;

// Client configuration, read from environment variables
dotenv.config();
const config = {
    host: process.env.HOST,
    name: process.env.AGENT_NAME,
    token: process.env.TOKEN
}

if (!config.host || !config.name || !config.token) {
    console.error("Missing one of the required environment variables: HOST, AGENT_NAME, TOKEN");
    process.exit(1);
}

const client = new DeliverooApi(
    config.host + '/?name=' + config.name,
    // config.token
)

await client.onConnect(() => {
    console.log("Connected to the server");
})

/**
 * Update parcel position
 * @type { Map< string, {id: string, carriedBy?: string, x:number, y:number, reward:number} > }
 */
const parcels = new Map();
client.onParcelsSensing(async (pp) => {
    for (const p of pp) {
        parcels.set(p.id, p);
    }
    for (const p of parcels.values()) {
        if (pp.map(p => p.id).find(id => id === p.id) === undefined) {
            parcels.delete(p.id);
        }
    }
})

// Fetch position of the drop points and all walkable tiles
const depots = new Map();
const walkableTiles = new Map();
client.onMap((width, height, tiles) => {
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const tile = tiles[y * width + x];

            if (tile && typeof tile.type === 'number') {

                switch (tile.type) {
                    case 1: // walkable
                        walkableTiles.set(`${x},${y}`, {x, y});
                        break;
                    case 2: // depot - tiles are also walkable
                        walkableTiles.set(`${x},${y}`, {x, y});
                        depots.set(`${x},${y}`, {x, y});
                        break;
                    default:
                        break
                }
            }
        }
    }

    console.log("Depots: ", depots);
    console.log("Walkable tiles: ", walkableTiles);
});


/**
 * Update information of the agent
 * @type { {id:string, name:string, x:number, y:number, score:number} }
 */
const me = {id: null, name: null, x: null, y: null, score: null};
client.onYou(({id, name, x, y, score}) => {
    me.id = id
    me.name = name
    me.x = x
    me.y = y
    me.score = score
})

// <== INTENTION ==>
class Intention {

    /**
     * Plan currently used for achieving the intention
     */
    #current_plan;
    /**
     * @type { any[] } predicate is in the form ['go_to', x, y]
     */
    #predicate;

    #parent;
    #started = false;
    #stopped = false;

    constructor(parent, predicate) {
        this.#parent = parent;
        this.#predicate = predicate;
    }

    stop() {
        this.#stopped = true;

        if (this.#current_plan) {
            this.#current_plan.stop();
        }
    }

    get stopped() {
        return this.#stopped;
    }

    /**
     * @type { any[] } predicate is in the form ['go_to', x, y]
     */
    get predicate() {
        return this.#predicate;
    }

    /**
     * Using the plan library to achieve an intention
     */
    async achieve() {

        // Cannot start twice
        if (this.#started) {
            return this;
        } else {
            this.#started = true;
        }

        // Trying all plans in the library
        for (const planClass of planLibrary) {

            if (this.stopped) {
                throw ['Stopped intention: ', ...this.predicate];
            }

            if (planClass.isApplicableTo(...this.predicate)) {

                this.#current_plan = new planClass(this.#parent);
                console.log('Using plan: [', planClass.name, '] to achieve intention: [', ...this.predicate, ']');

                try {
                    const plan_res = await this.#current_plan.execute(...this.predicate);
                    console.log("Intention [", ...this.predicate, "] successfully completed using plan: [", planClass.name, "] with result: ", plan_res);

                    return plan_res
                } catch (error) {
                    console.log('Intention: [', ...this.predicate, '] failed, using plan: [', planClass.name, ']. Error: ', error);
                }
            }
        }

        if (this.stopped) {
            throw ['Stopped intention: ', ...this.predicate];
        }

        // No plans foud to satisfy intention
        throw ['No plan found to satisfy intention: ', ...this.predicate]
    }
}

class IntentionRevision {

    #intention_queue = [];

    get intention_queue() {
        return this.#intention_queue;
    }

    /**
     * Push a new predicate to `intention_queue`, old intention is replaced with new one
     * @param predicate - Predicate to push
     */
    async push(predicate) {

        // Check if the same intention is already queued
        if (this.intention_queue.find(i => i.predicate.join(' ') === predicate.join(' '))) {
            console.log("Intention [", predicate, "] is already in the queue, skipping it");
            return;
        }

        // Only one move intention can be queued at the time
        if (predicate[0] === 'go_to') {
            const isMove = this.intention_queue.find(i => i.predicate[0] === 'go_to');
            if (isMove) {
                console.log("Only one move intention can be queued at a time, skipping intention [", predicate, "]");
                return;
            }
        }

        // Queue is capped at a maximum intention size, not really necessary, just to avoid having too many intentions
        // in the queue at the same time, and slowing down the agent
        if (this.#intention_queue.length < INTENTION_QUEUE_SIZE) {
            const intention = new Intention(this, predicate)
            this.intention_queue.push(intention);
        } else {
            console.log("Max intention queue size reached, skipping intention [", predicate, "]");
        }
    }


    async loop() {
        while (true) {
            // Consumes intention_queue if not empty
            if (this.intention_queue.length > 0) {
                console.log('Current intention queue', this.intention_queue.map(i => i.predicate));

                // Current intention
                const intention = this.intention_queue[0];

                // Is queued intention still valid? Do I still want to achieve it?
                // TODO this hard-coded implementation is an example
                let id = intention.predicate[2]
                let p = parcels.get(id)
                if (p && p.carriedBy) {
                    console.log('Skipping intention because no more valid', intention.predicate)
                    continue;
                }

                // Start achieving intention
                await intention.achieve(planLibrary)
                    // Catch eventual error and continue
                    .catch(error => {
                        // console.log( 'Failed intention', ...intention.predicate, 'with error:', ...error )
                    });

                // Remove from the queue
                this.intention_queue.shift();
            }
            // Postpone next iteration at setImmediate
            await new Promise(res => setImmediate(res));
        }
    }
}


const agent = new IntentionRevision();
agent.loop()


// <== PLANS ==>
const planLibrary = [];

class Plan {

    #stopped = false;
    #parent;
    // this is an array of sub intention. Multiple ones could eventually being achieved in parallel.
    #sub_intentions = [];

    constructor(parent) {
        this.#parent = parent;
    }

    stop() {
        this.#stopped = true;
        for (const i of this.#sub_intentions) {
            i.stop();
        }
    }

    get stopped() {
        return this.#stopped;
    }

    async subIntention(predicate) {
        const sub_intention = new Intention(this, predicate);
        this.#sub_intentions.push(sub_intention);
        return sub_intention.achieve();
    }

    // <== METHOD TO OVERRIDE==>
    // These methods should be overridden in subclasses

    static isApplicableTo() {
        throw new Error('isApplicableTo() must be implemented in subclasses');
    }

    async execute() {
        throw new Error('execute() must be implemented in subclasses');
    }
}

class GoPickUp extends Plan {

    static isApplicableTo(command) {
        return command === 'go_pick_up';
    }

    async execute(command, x, y) {

        if (this.stopped) throw ['stopped']; // if stopped then quit
        await this.subIntention(['go_to', x, y]);

        if (this.stopped) throw ['stopped']; // if stopped then quit
        await client.emitPickup()

        if (this.stopped) throw ['stopped']; // if stopped then quit
        return true;
    }
}

class GoDropOff extends Plan {

    static isApplicableTo(command) {
        return command === 'go_drop_off';
    }

    async execute(command, x, y) {

        if (this.stopped) throw ['stopped'];
        await this.subIntention(['go_to', x, y]);

        if (this.stopped) throw ['stopped'];
        await client.emitPutdown();  // This is the correct method for dropping off parcels

        if (this.stopped) throw ['stopped'];
        return true;
    }
}

class BlindMove extends Plan {

    static isApplicableTo(command) {
        return command === 'go_to';
    }

    async execute(command, x, y) {

        while (me.x !== x || me.y !== y) {

            if (this.stopped) {
                throw ['stopped'];
            }

            let moved_horizontally;
            let moved_vertically;

            if (x > me.x) {
                moved_horizontally = await client.emitMove('right')
            } else if (x < me.x) {
                moved_horizontally = await client.emitMove('left')
            }

            if (moved_horizontally) {
                me.x = moved_horizontally.x;
                me.y = moved_horizontally.y;
            }

            if (this.stopped) {
                throw ['stopped'];
            }

            if (y > me.y) {
                moved_vertically = await client.emitMove('up')
            } else if (y < me.y) {
                moved_vertically = await client.emitMove('down')
            }

            if (moved_vertically) {
                me.x = moved_vertically.x;
                me.y = moved_vertically.y;
            }

            if (!moved_horizontally && !moved_vertically) {
                throw 'stucked';
            }
        }

        return true;
    }
}

// Takes in consideration which tiles are walkable, should avoid penalties
// TODO Can also add collision avoidance against other agents
class SemiBlindMove extends Plan {

    static isApplicableTo(command) {
        return command === 'go_to';
    }

    async execute(command, x, y) {

        while (me.x !== x || me.y !== y) {

            if (this.stopped) {
                throw ['stopped'];
            }

            let moved_horizontally;
            let moved_vertically;

            if (x > me.x && isWalkable(me.x + 1, me.y)) {
                console.log('moving right')
                moved_horizontally = await client.emitMove('right')
            } else if (x < me.x && isWalkable(me.x - 1, me.y)) {
                console.log('moving left')

                moved_horizontally = await client.emitMove('left')
            }

            if (moved_horizontally) {
                me.x = moved_horizontally.x;
                me.y = moved_horizontally.y;
            }

            if (this.stopped) {
                throw ['stopped'];
            }

            if (y > me.y && isWalkable(me.x, me.y + 1)) {
                console.log('moving up')

                moved_vertically = await client.emitMove('up')
            } else if (y < me.y && isWalkable(me.x, me.y - 1)) {
                console.log('moving down')

                moved_vertically = await client.emitMove('down')
            }

            if (moved_vertically) {
                me.x = moved_vertically.x;
                me.y = moved_vertically.y;
            }

            if (!moved_horizontally && !moved_vertically) {
                throw 'stucked';
            }
        }

        return true;
    }
}

planLibrary.push(GoPickUp)
planLibrary.push(GoDropOff)
// planLibrary.push(BlindMove)
planLibrary.push(SemiBlindMove)

/**
 * Options generation and filtering function
 */
function optionsGeneration() {

    const options = [];

    // If carrying a parcel, add drop_off to options
    const carryingParcel = Array.from(parcels.values()).find(p => p.carriedBy === me.id);
    if (carryingParcel) {
        // Find the nearest depot to drop off the parcel
        let minDist = Infinity;
        let bestDepot = null;

        for (const d of depots.values()) {
            const dist = distance(me, d);
            if (dist < minDist) {
                minDist = dist;
                bestDepot = d;
            }
        }

        options.push(['go_drop_off', bestDepot.x, bestDepot.y]);
    }

    // Check if there are any parcels to pick up
    for (const p of parcels.values()) {
        if (!p.carriedBy) {
            options.push(['go_pick_up', p.x, p.y, p.id]);
        }
    }

    // If no options are available, then add a random move to the option, picking from the walkable tiles map
    if (options.length === 0) {
        const walkableTilesArray = Array.from(walkableTiles.values());
        const randomIndex = Math.floor(Math.random() * walkableTilesArray.length);
        const {x, y} = walkableTilesArray[randomIndex];

        options.push(['go_to', x, y]);
    }

    // 4. Select the nearest option
    let bestOption = null;
    let minDistance = Infinity;

    console.log("Options: ", options);
    for (const option of options) {
        const [command, x, y] = option;
        const dist = distance(me, {x, y});

        // Give priority to drop_off
        // TODO Could be improved by checking if any parcel are along the drop_off path
        if (command === 'go_drop_off') {
            bestOption = option;
            break;
        } else if (dist < minDistance) {
            bestOption = option;
            minDistance = dist;
        }
    }

    if (bestOption) {
        agent.push(bestOption);
    }
}

client.onParcelsSensing(optionsGeneration)
client.onAgentsSensing(optionsGeneration)
client.onYou(optionsGeneration)

// <== UTILS ==>
function distance({x: x1, y: y1}, {x: x2, y: y2}) {
    const dx = Math.abs(Math.round(x1) - Math.round(x2))
    const dy = Math.abs(Math.round(y1) - Math.round(y2))
    return dx + dy;
}

function isWalkable(x, y) {
    return walkableTiles.has(`${x},${y}`);
}