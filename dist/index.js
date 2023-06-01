"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Adapter = void 0;
const events_1 = require("events");
const socket_io_parser_1 = require("socket.io-parser");
// const delayBroadcastEnabled = process.env.DELAY_BROADCAST_ENABLED === "true";
const delayBroadcastMilli = process.env.DELAY_BROADCAST_MILLI ? parseInt(process.env.DELAY_BROADCAST_MILLI) : 1000;
const delayBroadcastBatchSize = process.env.DELAY_BROADCAST_BATCH_SIZE ? parseInt(process.env.DELAY_BROADCAST_BATCH_SIZE) : 80;
var delayBroadcastTimerRunning = false;

class InMemoryPackets {
    constructor() {
        this.packets = new Array();
        this.packetOpts;
    }

    addPacket(packet, packetOpts) {
        this.packets.push(packet);
        this.packetOpts = packetOpts;
    }

    popPackets(maxsize) {
        return this.packets.splice(0, maxsize);
    }

    popPackets() {
        return this.packets.splice(0, this.packets.length);
    }

    getPacketOpts() {
        return this.packetOpts;
    }

    packetLength() {
        return this.packets.length;
    }
}

class Adapter extends events_1.EventEmitter {
    /**
     * In-memory adapter constructor.
     *
     * @param {Namespace} nsp
     */
    constructor(nsp, isRoomBroadcastMsgBatchingAllowedCheckFunc, excludeBatchMap) {
        super();
        this.nsp = nsp;
        this.rooms = new Map();
        this.sids = new Map();
        this.encoder = nsp.server.encoder;
        this.inMemoryPackets = new Map();
        this.isRoomBroadcastMsgBatchingAllowedCheckFunc = isRoomBroadcastMsgBatchingAllowedCheckFunc ? isRoomBroadcastMsgBatchingAllowedCheckFunc : null;
        this.excludeBatchMap = excludeBatchMap ? excludeBatchMap : new Map();
    }
    /**
     * To be overridden
     */
    init() { }
    /**
     * To be overridden
     */
    close() { }
    /**
     * Adds a socket to a list of room.
     *
     * @param {SocketId}  id      the socket id
     * @param {Set<Room>} rooms   a set of rooms
     * @public
     */
    addAll(id, rooms) {
        if (!this.sids.has(id)) {
            this.sids.set(id, new Set());
        }
        for (const room of rooms) {
            this.sids.get(id).add(room);
            if (!this.rooms.has(room)) {
                if (this.isRoomBroadcastMsgBatchingAllowedCheckFunc !== null && this.isRoomBroadcastMsgBatchingAllowedCheckFunc(room)) {
                    this.inMemoryPackets.set(room, new InMemoryPackets());
                }

                this.rooms.set(room, new Set());
                this.emit("create-room", room);

                if (delayBroadcastTimerRunning === false && this.inMemoryPackets.size > 0) {
                    console.log("TODO:my-socket-join-2.3 - started delayed timer - ", Date.now());
                    delayBroadcastTimerRunning = true;
                    setTimeout(this.sendInMemoryPackets.bind(this), delayBroadcastMilli);
                }
            }
            if (!this.rooms.get(room).has(id)) {
                this.rooms.get(room).add(id);
                this.emit("join-room", room, id);
            }
        }
    }

    /**
     * Removes a socket from a room.
     *
     * @param {SocketId} id     the socket id
     * @param {Room}     room   the room name
     */
    del(id, room) {
        if (this.sids.has(id)) {
            this.sids.get(id).delete(room);
        }
        this._del(room, id);
    }
    _del(room, id) {
        if (this.rooms.has(room)) {
            const deleted = this.rooms.get(room).delete(id);
            if (deleted) {
                this.emit("leave-room", room, id);
            }

            if (this.rooms.get(room).size === 0) {
                this.inMemoryPackets.delete(room);
                this.rooms.delete(room);
                this.emit("delete-room", room);
            }
        }
    }
    /**
     * Removes a socket from all rooms it's joined.
     *
     * @param {SocketId} id   the socket id
     */
    delAll(id) {
        if (!this.sids.has(id)) {
            return;
        }
        for (const room of this.sids.get(id)) {
            this._del(room, id);
        }
        this.sids.delete(id);
    }
    /**
     * Broadcasts a packet.
     *
     * Options:
     *  - `flags` {Object} flags for this packet
     *  - `except` {Array} sids that should be excluded
     *  - `rooms` {Array} list of rooms to broadcast to
     *
     * @param {Object} packet   the packet object
     * @param {Object} opts     the options
     * @public
     */
    broadcast(packet, opts) {
        const flags = opts.flags || {};
        const packetOpts = {
            preEncoded: true,
            volatile: flags.volatile,
            compress: flags.compress
        };
        packet.nsp = this.nsp.name;
        const encodedPackets = this.encoder.encode(packet);
        
        /**
         * exclude section and action
         */
        let excludeActionsInBatching = false;
        const section = packet?.data[1]?.data?.section;
        const action = packet?.data[1]?.data?.payload?.action;
        console.log('this.excludeBatchMap:::', this.excludeBatchMap);
        if(this.excludeBatchMap.size > 0 && this.excludeBatchMap.has(section) && this.excludeBatchMap.get(section).has(action)) {
            excludeActionsInBatching = true;
        }

       /**
        * Check if for all the rooms broadcast batching is enabled.
        */
        var isAllRoomsBroadcastMsgBatchingAllowed = true;
        for (const room of opts.rooms) {
            if (this.inMemoryPackets.has(room) === false) {
                isAllRoomsBroadcastMsgBatchingAllowed = false;
                break;
            }
        }

        if (!excludeActionsInBatching && ((isAllRoomsBroadcastMsgBatchingAllowed === true && opts.except.size === 0) || (isAllRoomsBroadcastMsgBatchingAllowed === true && opts.except.size === 1 && (this.sids.has(opts.except.values().next().value) || this.rooms.has(opts.except.values().next().value) === false)))) {
            for (const room of opts.rooms) {
                this.inMemoryPackets.get(room).addPacket(encodedPackets[0], packetOpts);
            }
        } else {
            this.apply(opts, socket => {
                socket.packet(encodedPackets, packetOpts);
            });
        }
    }

    sendInMemoryPackets() {
        try {
            if (this.inMemoryPackets.size !== 0) {
                var startTime = Date.now();
                this.inMemoryPackets.forEach((packets, room) => {

                    if (packets.packetLength() !== 0) {
                        process.nextTick(this.broadcastInMemoryPackets.bind(this, packets, room));
                    }
                });
            }
        } catch (error) {
            console.log("error - ", error);
        } finally {
            setTimeout(this.sendInMemoryPackets.bind(this), delayBroadcastMilli);
        }
    }

    broadcastInMemoryPackets(packets, room) {
        const opts = {
            rooms: new Set([room]),
            except: new Set()
        };
        const batchedBroadcastPackets = {
            type: socket_io_parser_1.PacketType.EVENT,
            data: ["batchedBroadcast", packets.popPackets(delayBroadcastBatchSize)],
            nsp: this.nsp.name
        };
        const encodedBatchedBroadcastPackets = this.encoder.encode(batchedBroadcastPackets);
        const batchedBroadcastPacketsOpts = packets.getPacketOpts();

        this.apply(opts, socket => {
            socket.packet(encodedBatchedBroadcastPackets, batchedBroadcastPacketsOpts);
        });
    }

    /**
     * Gets a list of sockets by sid.
     *
     * @param {Set<Room>} rooms   the explicit set of rooms to check.
     */
    sockets(rooms) {
        const sids = new Set();
        this.apply({ rooms }, socket => {
            sids.add(socket.id);
        });
        return Promise.resolve(sids);
    }
    /**
     * Gets the list of rooms a given socket has joined.
     *
     * @param {SocketId} id   the socket id
     */
    socketRooms(id) {
        return this.sids.get(id);
    }
    /**
     * Returns the matching socket instances
     *
     * @param opts - the filters to apply
     */
    fetchSockets(opts) {
        const sockets = [];
        this.apply(opts, socket => {
            sockets.push(socket);
        });
        return Promise.resolve(sockets);
    }
    /**
     * Makes the matching socket instances join the specified rooms
     *
     * @param opts - the filters to apply
     * @param rooms - the rooms to join
     */
    addSockets(opts, rooms) {
        this.apply(opts, socket => {
            socket.join(rooms);
        });
    }
    /**
     * Makes the matching socket instances leave the specified rooms
     *
     * @param opts - the filters to apply
     * @param rooms - the rooms to leave
     */
    delSockets(opts, rooms) {
        this.apply(opts, socket => {
            rooms.forEach(room => socket.leave(room));
        });
    }
    /**
     * Makes the matching socket instances disconnect
     *
     * @param opts - the filters to apply
     * @param close - whether to close the underlying connection
     */
    disconnectSockets(opts, close) {
        this.apply(opts, socket => {
            socket.disconnect(close);
        });
    }
    apply(opts, callback) {
        const rooms = opts.rooms;
        const except = this.computeExceptSids(opts.except);
        if (rooms.size) {
            const ids = new Set();
            for (const room of rooms) {
                if (!this.rooms.has(room))
                    continue;
                for (const id of this.rooms.get(room)) {
                    if (ids.has(id) || except.has(id))
                        continue;
                    const socket = this.nsp.sockets.get(id);
                    if (socket) {
                        callback(socket);
                        ids.add(id);
                    }
                }
            }
        }
        else {
            for (const [id] of this.sids) {
                if (except.has(id))
                    continue;
                const socket = this.nsp.sockets.get(id);
                if (socket)
                    callback(socket);
            }
        }
    }
    computeExceptSids(exceptRooms) {
        const exceptSids = new Set();
        if (exceptRooms && exceptRooms.size > 0) {
            for (const room of exceptRooms) {
                if (this.rooms.has(room)) {
                    this.rooms.get(room).forEach(sid => exceptSids.add(sid));
                }
            }
        }
        return exceptSids;
    }
}
exports.Adapter = Adapter;
