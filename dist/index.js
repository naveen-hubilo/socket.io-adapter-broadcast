"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Adapter = void 0;
const events_1 = require("events");
const socket_io_parser_1 = require("socket.io-parser");
const delayBroadcastEnabled = process.env.DELAY_BROADCAST_ENABLED === "true";
const delayBroadcastMilli = process.env.DELAY_BROADCAST_MILLI ? parseInt(process.env.DELAY_BROADCAST_MILLI) : 5000;
const delayBroadcastBatchSize = process.env.DELAY_BROADCAST_BATCH_SIZE ? parseInt(process.env.DELAY_BROADCAST_BATCH_SIZE) : 80;
var delayBroadcastTimerRunning = false;

class InMemoryPackets {
    constructor(){
        this.packets = new Array();
        this.packetOpts;
    }

    addPacket(packet, packetOpts){
        this.packets.push(packet);
        this.packetOpts=packetOpts;
    }

    popPackets(maxsize){
        return this.packets.splice(0, maxsize);
    }

    popPackets(){
        return this.packets.splice(0, this.packets.length);
    }

    getPacketOpts(){
        return this.packetOpts;
    }

    packetLength(){
        return this.packets.length;
    }
}

class Adapter extends events_1.EventEmitter {
    /**
     * In-memory adapter constructor.
     *
     * @param {Namespace} nsp
     */
    constructor(nsp) {
        super();
        this.nsp = nsp;
        this.rooms = new Map();
        this.sids = new Map();
        this.encoder = nsp.server.encoder;
        this.inMemoryPackets = new Map();
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
        // console.log("TODO:my-socket-join-2.1 - id - ", id);
        // console.log("TODO:my-socket-join-2.2 - rooms - ", rooms);
        if (!this.sids.has(id)) {
            this.sids.set(id, new Set());
        }
        for (const room of rooms) {
            this.sids.get(id).add(room);
            if (!this.rooms.has(room)) {
                // console.log("delayBroadcastEnabled, delayBroadcastTimerRunning, delayBroadcastMilli, delayBroadcastBatchSize - ", delayBroadcastEnabled, delayBroadcastTimerRunning, delayBroadcastMilli, delayBroadcastBatchSize);
                // console.log("TODO:my-socket-join-2.3 - create-room - ", room);
                if(delayBroadcastEnabled === true){
                    console.log("Adding inMemoryPacket.");
                    this.inMemoryPackets.set(room, new InMemoryPackets());
                }

                this.rooms.set(room, new Set());
                this.emit("create-room", room);

                if(delayBroadcastEnabled === true && delayBroadcastTimerRunning === false){
                    console.log("TODO:my-socket-join-2.3 - started delayed timer");
                    delayBroadcastTimerRunning = true;
                    setTimeout(this.sendInMemoryPackets.bind(this), delayBroadcastMilli);
                }
            }
            if (!this.rooms.get(room).has(id)) {
                // console.log("TODO:my-socket-join-2.4 - join-room - ", room);
                // console.log("TODO:my-socket-join-2.5 - join-room - id - ", id);
                this.rooms.get(room).add(id);
                this.emit("join-room", room, id);
            }

            // console.log("TODO:my-socket-join-2.6 - room, this.rooms.get(room) - ", room, this.rooms.get(room));
        }
    }

    /**
     * Removes a socket from a room.
     *
     * @param {SocketId} id     the socket id
     * @param {Room}     room   the room name
     */
    del(id, room) {
        // console.log("TODO:my-socket-leave-2 - room - id - ", room, id);
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

            // console.log("TODO:my-socket-leave-3.1 - room - id - ", room, id);

            if (this.rooms.get(room).size === 0) {
                // console.log("TODO:my-socket-leave-3.2 - this.rooms.get(room) - id - ", this.rooms.get(room), id);
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
        // console.log("TODO:my-socket-5.1 - packet - ", packet.length);
        // console.log("TODO:my-socket-5.2 - opts - ", opts);
        const flags = opts.flags || {};
        const packetOpts = {
            preEncoded: true,
            volatile: flags.volatile,
            compress: flags.compress
        };
        packet.nsp = this.nsp.name;
        const encodedPackets = this.encoder.encode(packet);
        // const myPacket={ type: 2, data: ["hubiloBroadcast","I am deeply honored to be given the opportunity to share my experience as a student for the alumni."], nsp: '/' };
        // myPacket.nsp = this.nsp.name;
        // const myEncodedPackets = this.encoder.encode(myPacket);

        if((delayBroadcastEnabled === true && opts.except.size === 0) || (delayBroadcastEnabled === true && opts.except.size === 1 && this.sids.has(opts.except.values().next().value))){
            // console.log("TODO:my-socket-5.3 - ");
            for (const room of opts.rooms) {
                // console.log("TODO:my-socket-5.4 - room - encodedPackets - packetOpts - ", room, encodedPackets, packetOpts);
                this.inMemoryPackets.get(room).addPacket(encodedPackets[0], packetOpts);
            }
        }else{
            // console.log("TODO:my-socket-5.5 - ");
            this.apply(opts, socket => {
                // console.log("TODO:my-socket-7.1 - opts - ", opts);
                // console.log("TODO:my-socket-7.2 - socket.id - ", socket.id);
                socket.packet(encodedPackets, packetOpts);
            });
        }
    }

    sendInMemoryPackets(){
        try {
            // console.log("TODO:my-socket-delayed-9.0 - ", new Date());
            if(this.inMemoryPackets.size!==0){
                var startTime = Date.now();
                // console.log("TODO:my-socket-delayed-9.1 - this.packets.size - ", this.packets.size);
                this.inMemoryPackets.forEach((packets, room) => {
                    // console.log("TODO:my-socket-delayed-10.1 - room - ", room);

                    if(packets.packetLength()!==0){
                        console.log("TODO:my-socket-delayed-10.2 - room, packets.size - ", room, JSON.stringify(packets),packets.packetLength(), Date.now());
                        process.nextTick(this.broadcastInMemoryPackets.bind(this, packets,room));
                    }
                });
                console.log("TODO:my-socket-6 - sendInMemoryPackets.time - ", startTime , Date.now()- startTime);
            }
        } catch (error) {
            console.log("error - ", error);
        }finally{
            // console.log("TODO:my-socket-delayed-9.2 -");
            setTimeout(this.sendInMemoryPackets.bind(this), delayBroadcastMilli);
        }
    }

    broadcastInMemoryPackets(packets, room) {    
        // console.log("TODO:my-socket-11.1 - packets - ", packets);
        // console.log("TODO:my-socket-11.2 - room - ", room);
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
        const batchedBroadcastPacketsOpts =packets.getPacketOpts();

        console.log("batchedBroadcastPackets - ", batchedBroadcastPackets);

        //console.log("TODO:my-socket-delayed-10.3 - Post popup, room, packets.size, this.packets.size - ", room, packets.packetLength(), this.packets.get(room).packetLength());

        this.apply(opts, socket => {
            // console.log("TODO:my-socket-12.1 - socket.id - ", socket.id);
            // console.log("TODO:my-socket-12.2 - encodedPackets - packetOpts - ", encodedPackets, packetOpts);
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
        var startTime = Date.now();
        // console.log("TODO:my-socket-6 - opts - ",  opts);
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
        console.log("TODO:my-socket-6 - apply.time - ",  Date.now()- startTime);
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
