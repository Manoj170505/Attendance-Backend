const ZKLib = require('node-zklib');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');

// ================================================================
// DEFENSIVE MONKEY-PATCH FOR NODE-ZKLIB (Fixes null subarray crash)
// ================================================================
try {
  const ZKLibTCP = require('node-zklib/zklibtcp');
  const { createTCPHeader, decodeTCPHeader, checkNotEventTCP } = require('node-zklib/utils');
  const { COMMANDS, MAX_CHUNK } = require('node-zklib/constants');

  ZKLibTCP.prototype.readWithBuffer = function (reqData, cb) {
    var self = this;
    return new Promise(function (resolve, reject) {
      self.replyId++;
      var buf = createTCPHeader(COMMANDS.CMD_DATA_WRRQ, self.sessionId, self.replyId, reqData);

      self.requestData(buf)
        .then(function (reply) {
          if (!reply || reply.length < 16) {
            return reject(new Error('Device returned empty or invalid response buffer on port 4370'));
          }

          var header = decodeTCPHeader(reply.subarray(0, 16));
          switch (header.commandId) {
            case COMMANDS.CMD_DATA: {
              return resolve({ data: reply.subarray(16), mode: 8 });
            }
            case COMMANDS.CMD_ACK_OK:
            case COMMANDS.CMD_PREPARE_DATA: {
              var recvData = reply.subarray(16);
              if (!recvData || recvData.length < 5) {
                return reject(new Error('Device response payload too short'));
              }
              var size = recvData.readUIntLE(1, 4);
              var remain = size % MAX_CHUNK;
              var numberChunks = Math.round(size - remain) / MAX_CHUNK;
              var totalPackets = numberChunks + (remain > 0 ? 1 : 0);
              var replyData = Buffer.from([]);
              var totalBuffer = Buffer.from([]);
              var realTotalBuffer = Buffer.from([]);

              var timeout = 10000;
              var timer = setTimeout(function () {
                internalCallback(replyData, new Error('TIMEOUT WHEN RECEIVING PACKET'));
              }, timeout);

              var internalCallback = function (data, err) {
                if (timer) clearTimeout(timer);
                resolve({ data: data, err: err || null });
              };

              var handleOnData = function (packet) {
                if (checkNotEventTCP(packet)) return;
                if (timer) clearTimeout(timer);
                timer = setTimeout(function () {
                  internalCallback(replyData, new Error('TIMEOUT ON PACKETS REMAINING: ' + totalPackets));
                }, timeout);

                totalBuffer = Buffer.concat([totalBuffer, packet]);
                var packetLength = totalBuffer.readUIntLE(4, 2);
                if (totalBuffer.length >= 8 + packetLength) {
                  realTotalBuffer = Buffer.concat([realTotalBuffer, totalBuffer.subarray(16, 8 + packetLength)]);
                  totalBuffer = totalBuffer.subarray(8 + packetLength);

                  if (
                    (totalPackets > 1 && realTotalBuffer.length === MAX_CHUNK + 8) ||
                    (totalPackets === 1 && realTotalBuffer.length === remain + 8)
                  ) {
                    replyData = Buffer.concat([replyData, realTotalBuffer.subarray(8)]);
                    totalBuffer = Buffer.from([]);
                    realTotalBuffer = Buffer.from([]);

                    totalPackets -= 1;
                    if (cb) cb(replyData.length, size);

                    if (totalPackets <= 0) {
                      internalCallback(replyData);
                    }
                  }
                }
              };

              self.socket.on('data', handleOnData);

              for (var i = 0; i < totalPackets; i++) {
                var sizeReq = i === totalPackets - 1 ? remain : MAX_CHUNK;
                self.sendChunkRequest(i * MAX_CHUNK, sizeReq);
              }
              break;
            }
            default: {
              return reject(new Error('Invalid command response code: ' + header.commandId));
            }
          }
        })
        .catch(function (err) {
          reject(err);
        });
    });
  };

  function parseZKTimeToDate(time) {
    if (!time || typeof time !== 'number' || isNaN(time) || time <= 0) return null;
    try {
      const second = time % 60;
      time = Math.floor(time / 60);
      const minute = time % 60;
      time = Math.floor(time / 60);
      const hour = time % 24;
      time = Math.floor(time / 24);
      const day = (time % 31) + 1;
      time = Math.floor(time / 31);
      const month = time % 12;
      time = Math.floor(time / 12);
      const year = time + 2000;
      
      const d = new Date(year, month, day, hour, minute, second);
      return isNaN(d.getTime()) || year < 2020 ? null : d;
    } catch (e) {
      return null;
    }
  }

  function customDecodeRecordData40(recordData) {
    const userSn = recordData.readUIntLE(0, 2);
    const deviceUserId = recordData.slice(2, 26).toString('ascii').split('\0').shift().trim();
    const verifyType = recordData.length > 26 ? recordData.readUInt8(26) : 1;
    
    const timeVal = recordData.length >= 31 ? recordData.readUInt32LE(27) : 0;
    const recordTime = parseZKTimeToDate(timeVal);

    // Punch state: Byte 31 on BioMax/eSSL/ZKTeco (0=Check In, 1=Check Out, 2=Break Out, 3=Break In, 4=OT In, 5=OT Out)
    const b31 = recordData.length > 31 ? recordData.readUInt8(31) : 0;
    const b32 = recordData.length > 32 ? recordData.readUInt8(32) : 0;
    
    let detectedState = 0;
    if (b31 >= 0 && b31 <= 5) {
      detectedState = b31;
    } else if (b32 >= 0 && b32 <= 5) {
      detectedState = b32;
    }

    const workCode = recordData.length >= 36 ? recordData.readUInt32LE(32) : 0;

    return {
      userSn,
      deviceUserId,
      verifyType,
      recordTime,
      recordType: detectedState,
      status: detectedState,
      state: detectedState,
      workCode,
      rawHex: recordData.toString('hex')
    };
  }

  ZKLibTCP.prototype.getAttendances = async function (callbackInProcess = () => { }) {
    const { REQUEST_DATA } = require('node-zklib/constants');
    if (this.socket) {
      try { await this.freeData(); } catch (err) { return Promise.reject(err); }
    }
    let data = null;
    try {
      data = await this.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS, callbackInProcess);
    } catch (err) {
      return Promise.reject(err);
    }
    if (this.socket) {
      try { await this.freeData(); } catch (err) { return Promise.reject(err); }
    }
    const RECORD_PACKET_SIZE = 40;
    let recordData = data.data.subarray(4);
    let records = [];
    while (recordData.length >= RECORD_PACKET_SIZE) {
      const record = customDecodeRecordData40(recordData.subarray(0, RECORD_PACKET_SIZE));
      if (record && record.recordTime && record.deviceUserId) {
        records.push({ ...record, ip: this.ip });
      }
      recordData = recordData.subarray(RECORD_PACKET_SIZE);
    }
    return { data: records, err: data.err };
  };
} catch (patchErr) {
  console.warn('⚠️ Could not apply ZKLibTCP monkey-patch:', patchErr.message);
}

const CONFIG_PATH = path.join(__dirname, 'config.json');
const CACHE_PATH = path.join(__dirname, 'synced_cache.json');

// Load Configuration
let config = {
  deviceIp: '192.168.137.41',
  devicePort: 4370,
  deviceSerial: 'NFZ8235301513',
  cloudApiUrl: 'https://attendance-backend-production-48ca.up.railway.app',
  pollIntervalSeconds: 3
};

if (fs.existsSync(CONFIG_PATH)) {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = Object.assign({}, config, JSON.parse(raw));
  } catch (err) {
    console.error('⚠️ Could not parse config.json, using defaults:', err.message);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`💾 [AUTO-SAVED] Updated config.json with discovered IP: ${config.deviceIp}`);
  } catch (err) {
    console.error('⚠️ Error saving config:', err.message);
  }
}

// Load Cache of Synced Punches to prevent duplicate submissions
let syncedCache = new Set();
if (fs.existsSync(CACHE_PATH)) {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const arr = JSON.parse(raw);
    syncedCache = new Set(arr);
  } catch (err) {
    syncedCache = new Set();
  }
}

function saveCache() {
  try {
    const arr = Array.from(syncedCache).slice(-5000);
    fs.writeFileSync(CACHE_PATH, JSON.stringify(arr, null, 2));
  } catch (err) {
    console.error('⚠️ Error saving synced cache:', err.message);
  }
}

console.log('================================================================');
console.log('🚀 UNIVERSAL BIOMETRIC LOCAL SYNC AGENT (eSSL / ZKTeco / BioMax)');
console.log('================================================================');
console.log(`🔒 Target Device IP:    ${config.deviceIp}:${config.devicePort}`);
console.log(`🏷️ Device Serial No:    ${config.deviceSerial}`);
console.log(`☁️ Cloud Server URL:    ${config.cloudApiUrl}`);
console.log(`⏱️ Sync Polling Rate:   Every ${config.pollIntervalSeconds} seconds`);
console.log('================================================================\n');

let zk = new ZKLib(config.deviceIp, config.devicePort, 10000, 4000);
let isConnected = false;
let isPolling = false;
let consecutiveFailures = 0;

// Subnet scanner function to find port 4370 devices automatically
function testPort(ip, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isSettled = false;

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      if (!isSettled) {
        isSettled = true;
        socket.destroy();
        resolve(true);
      }
    });
    socket.on('timeout', () => {
      if (!isSettled) {
        isSettled = true;
        socket.destroy();
        resolve(false);
      }
    });
    socket.on('error', () => {
      if (!isSettled) {
        isSettled = true;
        socket.destroy();
        resolve(false);
      }
    });
    socket.connect(port, ip);
  });
}

async function discoverDeviceIp() {
  console.log('🔍 [AUTO-DISCOVERY] Searching local network for eSSL / ZKTeco machine on port 4370...');
  const interfaces = os.networkInterfaces();
  const candidatePrefixes = new Set();

  for (const name of Object.keys(interfaces)) {
    for (const netInfo of interfaces[name] || []) {
      if (netInfo.family === 'IPv4' && !netInfo.internal) {
        const parts = netInfo.address.split('.');
        if (parts.length === 4) {
          candidatePrefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
        }
      }
    }
  }

  // Also include standard 192.168.137, 192.168.1, 192.168.0 subnets
  candidatePrefixes.add('192.168.137');
  candidatePrefixes.add('192.168.1');
  candidatePrefixes.add('192.168.0');

  for (const prefix of candidatePrefixes) {
    // Scan common host ranges (1 to 254) in parallel batches
    const batchSize = 35;
    for (let start = 1; start <= 254; start += batchSize) {
      const promises = [];
      for (let i = start; i < Math.min(start + batchSize, 255); i++) {
        const ip = `${prefix}.${i}`;
        promises.push(
          testPort(ip, config.devicePort).then((isOpen) => (isOpen ? ip : null))
        );
      }
      const results = await Promise.all(promises);
      const foundIp = results.find((ip) => ip !== null);
      if (foundIp) {
        console.log(`🎯 [DEVICE FOUND] Discovered active biometric terminal at: ${foundIp}:${config.devicePort}`);
        return foundIp;
      }
    }
  }
  return null;
}

// Function to send a punch to Railway Cloud REST API
async function pushPunchToCloud(record) {
  try {
    const employeeId = String(record.deviceUserId || record.userId || record.pin || record.user_sn || record.uid || '').trim();
    if (!employeeId) return false;

    const recordDate = record.recordTime ? new Date(record.recordTime) : (record.timestamp ? new Date(record.timestamp) : null);
    if (!recordDate || isNaN(recordDate.getTime())) {
      console.warn(`⚠️ [SKIP PUNCH] Invalid punch timestamp for employee PIN ${employeeId}`);
      return false;
    }

    const rawState = record.recordType !== undefined ? record.recordType : (record.status !== undefined ? record.status : (record.state !== undefined ? record.state : 0));
    const stateCode = String(rawState);

    const stateMap = {
      '0': 'CHECK_IN',
      '1': 'CHECK_OUT',
      '2': 'BREAK_OUT',
      '3': 'BREAK_IN',
      '4': 'OVERTIME_IN',
      '5': 'OVERTIME_OUT'
    };

    const verifyMap = {
      '1': 'FINGERPRINT',
      '2': 'PIN_PASSWORD',
      '3': 'CARD_RFID',
      '4': 'FINGER_CARD',
      '15': 'FACE_RECOGNITION',
      '200': 'PALM_VEIN'
    };
    const verifyCode = String(record.verifyType || 1);

    const payload = {
      deviceSerial: config.deviceSerial,
      employeeId,
      timestamp: recordDate.toISOString(),
      state: stateMap[stateCode] || 'CHECK_IN',
      punchType: verifyMap[verifyCode] || 'FINGERPRINT',
      rawData: `AGENT_PUNCH: ${employeeId}\t${recordDate.toISOString()}\t${stateMap[stateCode] || 'CHECK_IN'}`
    };

    const response = await axios.post(`${config.cloudApiUrl.replace(/\/$/, '')}/api/attendance/punch`, payload, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      if (response.data.isDuplicate) {
        return true; // Successfully acknowledged as already processed
      }
      console.log(`✅ [SYNCED TO CLOUD] Employee PIN: ${employeeId} | ${recordDate.toLocaleTimeString()} | State: ${payload.state} | Type: ${payload.punchType} | Packet: [${record.debugBytes || ''}]`);
      return true;
    }
  } catch (err) {
    const errMsg = (err.response && err.response.data && err.response.data.error) || err.message;
    console.error(`❌ [CLOUD SYNC ERROR] Failed to push punch:`, errMsg);
    return false;
  }
  return false;
}

// Function to fetch enrolled users & names from biometric device and sync to cloud
let lastUserSyncTime = 0;
const USER_SYNC_INTERVAL_MS = 60 * 1000;

async function syncUsersFromDevice() {
  if (!isConnected || !zk) return;
  try {
    const usersData = await zk.getUsers().catch((err) => {
      console.warn(`⚠️ [USER SYNC WARNING] Device returned empty or timed out on getUsers:`, err ? err.message : 'timeout');
      return null;
    });

    if (usersData && usersData.data && Array.isArray(usersData.data) && usersData.data.length > 0) {
      const usersToSync = usersData.data.map(u => ({
        employeeId: String(u.userId || u.deviceUserId || u.uid || '').trim(),
        name: u.name ? String(u.name).replace(/\0/g, '').trim() : '',
        cardNo: u.cardno ? String(u.cardno) : null,
        role: u.role
      })).filter(u => u.employeeId);

      if (usersToSync.length > 0) {
        const response = await axios.post(`${config.cloudApiUrl.replace(/\/$/, '')}/api/attendance/sync-users`, {
          deviceSerial: config.deviceSerial,
          users: usersToSync
        }, {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.success) {
          console.log(`👥 [USER SYNC] Successfully synced ${usersToSync.length} employee name(s) from biometric machine to cloud dashboard.`);
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ [USER SYNC WARNING] Could not fetch/sync device users: ${err ? err.message : err}`);
  }
}

// Function to send Heartbeat to Cloud Server
async function sendHeartbeat() {
  try {
    await axios.get(`${config.cloudApiUrl.replace(/\/$/, '')}/iclock/cdata?SN=${config.deviceSerial}`, {
      timeout: 10000
    });
  } catch (err) {
    // Silent heartbeat fail
  }
}

// Sync Loop
async function pollAttendanceLogs() {
  if (isPolling || !isConnected || !zk) return;
  isPolling = true;

  try {
    const logs = await zk.getAttendances().catch((err) => {
      console.warn(`⚠️ [POLL WARNING] Device returned empty or timed out on getAttendances:`, err ? err.message : 'timeout');
      return null;
    });

    if (logs && logs.data && Array.isArray(logs.data)) {
      let newPunches = 0;

      for (const log of logs.data) {
        if (!log || !log.deviceUserId) continue;
        const recordDate = log.recordTime ? new Date(log.recordTime) : null;
        if (!recordDate || isNaN(recordDate.getTime())) {
          continue; // Skip invalid timestamp
        }

        const uniqueKey = `${config.deviceSerial}_${log.deviceUserId}_${recordDate.getTime()}`;

        if (!syncedCache.has(uniqueKey)) {
          const success = await pushPunchToCloud({
            ...log,
            recordTime: recordDate
          });
          if (success) {
            syncedCache.add(uniqueKey);
            newPunches++;
          }
        }
      }

      if (newPunches > 0) {
        saveCache();
        console.log(`✨ [BATCH COMPLETE] Synced ${newPunches} new biometric punch(es) to cloud dashboard.\n`);
      }
    }
  } catch (err) {
    console.warn(`⚠️ [POLL WARNING] ${err ? err.message : err}`);
    if (err && err.message && (err.message.includes('timeout') || err.message.includes('closed') || err.message.includes('ECONNRESET'))) {
      isConnected = false;
    }
  } finally {
    isPolling = false;
  }
}

// Main Connection Routine
async function connectToDevice() {
  while (true) {
    if (!isConnected) {
      try {
        console.log(`📡 Connecting to eSSL / ZKTeco machine at ${config.deviceIp}:${config.devicePort}...`);
        await zk.createSocket();
        isConnected = true;
        consecutiveFailures = 0;
        console.log(`🟢 [CONNECTED TO DEVICE] Ready to capture live attendance punches!\n`);

        await sendHeartbeat();
        await syncUsersFromDevice();
        lastUserSyncTime = Date.now();
      } catch (err) {
        consecutiveFailures++;
        console.error(`🔴 [CONNECT FAILED] Could not reach machine at ${config.deviceIp}:${config.devicePort} (${err ? err.message : err}).`);
        isConnected = false;
        try { await zk.disconnect(); } catch (e) {}

        // If failed 2 times, trigger smart auto-discovery
        if (consecutiveFailures >= 2) {
          const autoFoundIp = await discoverDeviceIp();
          if (autoFoundIp && autoFoundIp !== config.deviceIp) {
            config.deviceIp = autoFoundIp;
            saveConfig();
            zk = new ZKLib(config.deviceIp, config.devicePort, 10000, 4000);
            consecutiveFailures = 0;
            continue;
          }
        }
      }
    }

    if (isConnected) {
      await pollAttendanceLogs();
      await sendHeartbeat();

      if (Date.now() - lastUserSyncTime >= USER_SYNC_INTERVAL_MS) {
        await syncUsersFromDevice();
        lastUserSyncTime = Date.now();
      }
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalSeconds * 1000));
  }
}

// Global safety exception handlers to prevent any process crashes
process.on('uncaughtException', (err) => {
  console.warn('⚠️ [SOCKET RECOVERED] Handled unexpected socket error:', err ? err.message : err);
  isConnected = false;
});

process.on('unhandledRejection', (reason) => {
  console.warn('⚠️ [PROMISE RECOVERED] Handled unhandled rejection:', reason ? reason.message || reason : 'Rejection');
  isConnected = false;
});

// Start Agent
connectToDevice().catch(console.error);

// Clean exit handlers
process.on('SIGINT', async () => {
  console.log('\n🛑 Stopping Biometric Sync Agent...');
  try { await zk.disconnect(); } catch (e) {}
  process.exit(0);
});
