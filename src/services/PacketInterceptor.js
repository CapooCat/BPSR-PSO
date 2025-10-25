import cap from 'cap';
import zlib from 'zlib';
import logger from './Logger.js';
import userDataManager from './UserDataManager.js';

import { PacketProcessor } from './PacketProcessor.js';
import { Lock } from '../models/Lock.js';
import { Readable } from 'stream';
import { findDefaultNetworkDevice } from './NetInterfaceService.js';

const Cap = cap.Cap;
const decoders = cap.decoders;
const PROTOCOL = decoders.PROTOCOL;

// ===== Constants (single source of truth) =====
const FILTER = 'ip and tcp';
const RINGBUF_SIZE = 10 * 1024 * 1024;
const SNAPBUF_SIZE = 65535;
const FRAGMENT_TIMEOUT = 30_000; // ms
const IF_CHECK_INTERVAL_MS = 3_000; // ms
const IF_SWITCH_DEBOUNCE_POLLS = 2;

// ===== Helpers =====
const clearDataOnServerChange = () => {
    userDataManager.refreshEnemyCache();
    if (
        !globalSettings?.autoClearOnServerChange ||
        userDataManager.lastLogTime === 0 ||
        userDataManager.users.size === 0
    )
        return;

    userDataManager.clearAll();
    logger.info('Server changed, statistics cleared!');
};

const assertZstdAvailableOrThrow = () => {
    if (!zlib.zstdDecompressSync) {
        const errorMsg = 'zstdDecompressSync is not available! Please update your Node.js!';
        logger.error(errorMsg);
        throw new Error(errorMsg);
    }
};

// ===== Packet Interceptor =====
export class PacketInterceptor {
    static start(server, port, resolve, reject) {
        server.listen(port, async () => {
            try {
                // — Device discovery —
                let devices = cap.deviceList();
                console.log('Auto detecting default network interface...');
                const initialDeviceNum = await findDefaultNetworkDevice(devices);
                if (initialDeviceNum === null || initialDeviceNum === undefined) {
                    throw new Error('Default network interface not found!');
                }

                // — Environment checks / startup logs —
                assertZstdAvailableOrThrow();
                const url = `http://localhost:${port}`;
                logger.info(`Web Server started at ${url}`);
                logger.info('WebSocket Server started');
                logger.info('Welcome!');
                logger.info('Attempting to find the game server, please wait!');

                // — Shared state —
                let current_server = '';
                let _data = Buffer.alloc(0);
                let tcp_next_seq = -1;
                let tcp_cache = new Map();
                let tcp_last_time = 0;
                const tcp_lock = new Lock();

                const clearTcpCache = () => {
                    _data = Buffer.alloc(0);
                    tcp_next_seq = -1;
                    tcp_last_time = 0;
                    tcp_cache.clear();
                };

                const fragmentIpCache = new Map();

                // ======== DO NOT CHANGE: getTCPPacket ========
                const getTCPPacket = (frameBuffer, ethOffset) => {
                    const ipPacket = decoders.IPV4(frameBuffer, ethOffset);
                    const ipId = ipPacket.info.id;
                    const isFragment = (ipPacket.info.flags & 0x1) !== 0;
                    const _key = `${ipId}-${ipPacket.info.srcaddr}-${ipPacket.info.dstaddr}-${ipPacket.info.protocol}`;
                    const now = Date.now();

                    if (isFragment || ipPacket.info.fragoffset > 0) {
                        if (!fragmentIpCache.has(_key)) {
                            fragmentIpCache.set(_key, { fragments: [], timestamp: now });
                        }
                        const cacheEntry = fragmentIpCache.get(_key);
                        cacheEntry.fragments.push(Buffer.from(frameBuffer.subarray(ethOffset)));
                        cacheEntry.timestamp = now;

                        if (isFragment) return null;

                        const { fragments } = cacheEntry;
                        if (!fragments) {
                            logger.error(`Can't find fragments for ${_key}`);
                            return null;
                        }

                        let totalLength = 0;
                        const fragmentData = [];
                        for (const buffer of fragments) {
                            const ip = decoders.IPV4(buffer);
                            const fragmentOffset = ip.info.fragoffset * 8;
                            const payloadLength = ip.info.totallen - ip.hdrlen;
                            const payload = Buffer.from(buffer.subarray(ip.offset, ip.offset + payloadLength));
                            fragmentData.push({ offset: fragmentOffset, payload });
                            const endOffset = fragmentOffset + payloadLength;
                            if (endOffset > totalLength) totalLength = endOffset;
                        }

                        const fullPayload = Buffer.alloc(totalLength);
                        for (const fragment of fragmentData) {
                            fragment.payload.copy(fullPayload, fragment.offset);
                        }
                        fragmentIpCache.delete(_key);
                        return fullPayload;
                    }
                    return Buffer.from(
                        frameBuffer.subarray(
                            ipPacket.offset,
                            ipPacket.offset + (ipPacket.info.totallen - ipPacket.hdrlen)
                        )
                    );
                };

                // — Capture lifecycle (single impl, reusable) —
                const snapBuffer = Buffer.alloc(SNAPBUF_SIZE);
                const eth_queue = [];
                let capInstance = null;
                let currentDeviceNum = initialDeviceNum;

                const attachPacketListener = (instance) => {
                    instance.on('packet', (nbytes) => {
                        eth_queue.push(Buffer.from(snapBuffer.subarray(0, nbytes)));
                    });
                };

                const openCaptureOnDevice = (deviceNum) => {
                    const instance = new Cap();
                    const deviceName = devices[deviceNum].name;
                    const linkType = instance.open(deviceName, FILTER, RINGBUF_SIZE, snapBuffer);
                    if (linkType !== 'ETHERNET') {
                        logger.error('The device seems to be WRONG! Please check the device! Device type: ' + linkType);
                    }
                    instance.setMinBytes && instance.setMinBytes(0);
                    attachPacketListener(instance);
                    logger.info(
                        `
                        =====================================================================================
                        
                        Capture opened on device #${deviceNum}: ${devices[deviceNum].description || deviceName}
                        
                        =====================================================================================
                        `
                    );
                    return instance;
                };

                const safeCloseCap = (instance) => {
                    try {
                        instance && instance.close && instance.close();
                    } catch (e) {
                        logger.debug('Error closing Cap instance (ignored): ' + e?.message);
                    }
                };

                const clearAllCachesOnDeviceSwitch = () => {
                    clearTcpCache();
                    fragmentIpCache.clear();
                    current_server = '';
                };

                const switchCaptureDevice = async (newDeviceNum) => {
                    await tcp_lock.acquire();
                    try {
                        if (newDeviceNum === currentDeviceNum) return;

                        logger.warn(
                            `Default network interface changed: #${currentDeviceNum} -> #${newDeviceNum}. Rebinding capture...`
                        );
                        safeCloseCap(capInstance);
                        capInstance = openCaptureOnDevice(newDeviceNum);
                        currentDeviceNum = newDeviceNum;
                        clearAllCachesOnDeviceSwitch();

                        if (globalSettings?.autoClearOnServerChange) {
                            userDataManager.clearAll();
                            logger.info('Network device changed, statistics cleared!');
                        }
                    } finally {
                        tcp_lock.release();
                    }
                };

                // — Initial open —
                capInstance = openCaptureOnDevice(currentDeviceNum);

                // ======== DO NOT CHANGE: processEthPacket ========
                const processEthPacket = async (frameBuffer) => {
                    const ethPacket = decoders.Ethernet(frameBuffer);
                    if (ethPacket.info.type !== PROTOCOL.ETHERNET.IPV4) return;

                    const ipPacket = decoders.IPV4(frameBuffer, ethPacket.offset);
                    const { srcaddr, dstaddr } = ipPacket.info;

                    const tcpBuffer = getTCPPacket(frameBuffer, ethPacket.offset);
                    if (tcpBuffer === null) return;

                    const tcpPacket = decoders.TCP(tcpBuffer);
                    const buf = Buffer.from(tcpBuffer.subarray(tcpPacket.hdrlen));
                    const { srcport, dstport } = tcpPacket.info;
                    const src_server = `${srcaddr}:${srcport} -> ${dstaddr}:${dstport}`;

                    await tcp_lock.acquire();
                    try {
                        if (current_server !== src_server) {
                            try {
                                if (buf[4] == 0) {
                                    const data = buf.subarray(10);
                                    if (data.length) {
                                        const stream = Readable.from(data, { objectMode: false });
                                        let data1;
                                        do {
                                            const len_buf = stream.read(4);
                                            if (!len_buf) break;

                                            const packetLength = len_buf.readUInt32BE();
                                            if (packetLength > 0x100000 || packetLength < 4) {
                                                logger.warn(
                                                    `Invalid packet length during server identification: ${packetLength}. Discarding buffer.`
                                                );
                                                stream.destroy();
                                                break;
                                            }

                                            data1 = stream.read(packetLength - 4);
                                            if (!data1) break;

                                            const signature = Buffer.from([0x00, 0x63, 0x33, 0x53, 0x42, 0x00]); //c3SB??
                                            if (
                                                Buffer.compare(data1.subarray(5, 5 + signature.length), signature) !== 0
                                            )
                                                break;

                                            if (current_server !== src_server) {
                                                current_server = src_server;
                                                clearTcpCache();
                                                tcp_next_seq = tcpPacket.info.seqno + buf.length;
                                                clearDataOnServerChange();
                                                logger.info('Got Scene Server Address: ' + src_server);
                                            }
                                        } while (data1 && data1.length);
                                    }
                                }
                                if (buf.length === 0x62) {
                                    const signature = Buffer.from([
                                        0x00, 0x00, 0x00, 0x62, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x11, 0x45,
                                        0x14, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x4e, 0x08, 0x01, 0x22, 0x24,
                                    ]);
                                    if (
                                        Buffer.compare(buf.subarray(0, 10), signature.subarray(0, 10)) === 0 &&
                                        Buffer.compare(buf.subarray(14, 14 + 6), signature.subarray(14, 14 + 6)) === 0
                                    ) {
                                        if (current_server !== src_server) {
                                            current_server = src_server;
                                            clearTcpCache();
                                            tcp_next_seq = tcpPacket.info.seqno + buf.length;
                                            clearDataOnServerChange();
                                            logger.info(
                                                'Got Scene Server Address by Login Return Packet: ' + src_server
                                            );
                                        }
                                    }
                                }
                            } catch (e) {}
                            return;
                        }

                        if (tcp_next_seq === -1) {
                            if (buf.length > 4 && buf.readUInt32BE() < 0x0fffff) {
                                tcp_next_seq = tcpPacket.info.seqno;
                            } else {
                                logger.error('Unexpected TCP capture error! tcp_next_seq is -1');
                            }
                        }

                        if (tcp_next_seq - tcpPacket.info.seqno <= 0 || tcp_next_seq === -1) {
                            tcp_cache.set(tcpPacket.info.seqno, buf);
                        }

                        while (tcp_cache.has(tcp_next_seq)) {
                            const seq = tcp_next_seq;
                            const cachedTcpData = tcp_cache.get(seq);
                            _data = _data.length === 0 ? cachedTcpData : Buffer.concat([_data, cachedTcpData]);
                            tcp_next_seq = (seq + cachedTcpData.length) >>> 0;
                            tcp_cache.delete(seq);
                            tcp_last_time = Date.now();
                        }

                        while (_data.length > 4) {
                            const packetSize = _data.readUInt32BE();
                            if (_data.length < packetSize) break;
                            if (packetSize > 0x0fffff) {
                                logger.error(
                                    `Invalid Length!! ${_data.length},${packetSize},${_data.toString('hex')},${tcp_next_seq}`
                                );
                                _data = Buffer.alloc(0);
                                break;
                            }
                            if (_data.length >= packetSize) {
                                const packet = _data.subarray(0, packetSize);
                                _data = _data.subarray(packetSize);
                                const processor = new PacketProcessor();
                                processor.processPacket(packet);
                            }
                        }
                    } finally {
                        tcp_lock.release();
                    }
                };

                // — Dequeue loop (single tight loop) —
                (async () => {
                    while (true) {
                        if (eth_queue.length) {
                            const pkt = eth_queue.shift();
                            await processEthPacket(pkt);
                        } else {
                            // micro-sleep to keep event loop breathing without burning CPU
                            await new Promise((r) => setTimeout(r, 1));
                        }
                    }
                })();

                // — Maintenance: fragment & TCP idle watchdog —
                setInterval(() => {
                    const now = Date.now();
                    let clearedFragments = 0;

                    fragmentIpCache.forEach((cacheEntry, key) => {
                        if (now - cacheEntry.timestamp > FRAGMENT_TIMEOUT) {
                            fragmentIpCache.delete(key);
                            clearedFragments++;
                        }
                    });

                    if (clearedFragments > 0) {
                        logger.debug(`Cleared ${clearedFragments} expired IP fragment caches`);
                    }

                    if (tcp_last_time && now - tcp_last_time > FRAGMENT_TIMEOUT) {
                        logger.warn(
                            'Cannot capture the next packet! Is the game closed or disconnected? seq: ' + tcp_next_seq
                        );
                        current_server = '';
                        clearTcpCache();
                    }
                }, 10_000);

                // — Default-interface watcher (debounced) —
                let lastSeenCandidate = currentDeviceNum;
                let stableCount = 0;

                setInterval(async () => {
                    try {
                        const freshDevices = cap.deviceList();
                        const candidate = await findDefaultNetworkDevice(freshDevices);
                        if (candidate === null || candidate === undefined) return;

                        if (candidate === lastSeenCandidate) {
                            stableCount++;
                        } else {
                            lastSeenCandidate = candidate;
                            stableCount = 1;
                        }

                        if (stableCount >= IF_SWITCH_DEBOUNCE_POLLS && candidate !== currentDeviceNum) {
                            // keep the same array reference so any closures referencing `devices` stay valid
                            devices.splice(0, devices.length, ...freshDevices);
                            await switchCaptureDevice(candidate);
                        }
                    } catch (err) {
                        logger.debug('Interface watcher error (ignored): ' + err?.message);
                    }
                }, IF_CHECK_INTERVAL_MS);

                resolve(url);
            } catch (err) {
                reject(err);
            }
        });
    }
}
