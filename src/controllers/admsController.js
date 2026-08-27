import prisma from '../config/prisma.js';
import { parseAdmsPayload } from '../utils/admsParser.js';

/**
 * Controller for BioMax / eSSL / ZKTeco ADMS (Push) Cloud Protocol
 */

/**
 * Helper to dynamically extract the Device Serial Number (SN) from any request location
 */
export const extractDeviceSN = (req) => {
  // 1. Query parameters (case-insensitive checks)
  const querySN = req.query.SN || req.query.sn || req.query.SerialNumber || req.query.serialNumber || req.query.serialno || req.query.deviceId || req.query.sn_id;
  if (querySN) return String(querySN).trim();

  // 2. HTTP Headers
  const headerSN = req.headers['x-serial-number'] || req.headers['sn'] || req.headers['serialnumber'] || req.headers['device-sn'] || req.headers['x-sn'];
  if (headerSN) return String(headerSN).trim();

  // 3. Parsed JSON / urlencoded body object
  if (req.body && typeof req.body === 'object') {
    const bodySN = req.body.SN || req.body.sn || req.body.SerialNumber || req.body.serialNumber;
    if (bodySN) return String(bodySN).trim();
  }

  // 4. Raw text string body search (e.g., "SN=NFZ8235301513\t..." or "~SerialNumber=...")
  if (typeof req.body === 'string') {
    const match = req.body.match(/(?:SN|sn|SerialNumber|~SerialNumber|serialNumber)=([^\s&,\r\n]+)/i);
    if (match && match[1]) return match[1].trim();
  }

  return 'UNKNOWN';
};

/**
 * GET /iclock/cdata or /cdata
 * Handshake / initialization request from biometric machine.
 * The machine pings this endpoint on boot or at regular intervals to receive server configuration parameters.
 */
export const handleCDataGet = async (req, res) => {
  try {
    const serialNumber = extractDeviceSN(req);
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const pushVer = req.query.pushver || req.query.PushProtVer || '2.4.1';
    const options = req.query.options || 'all';

    console.log(`==================== [ADMS HANDSHAKE - GET /cdata] ====================`);
    console.log(`📡 Time:         ${new Date().toISOString()}`);
    console.log(`🔒 Device SN:    ${serialNumber}`);
    console.log(`🌐 Client IP:    ${clientIp}`);
    console.log(`⚙️ Push Version: ${pushVer}`);
    console.log(`📋 Query:        ${JSON.stringify(req.query)}`);

    if (serialNumber && serialNumber !== 'UNKNOWN') {
      // Upsert device in database to record heartbeat & connection status
      await prisma.device.upsert({
        where: { serialNumber },
        update: {
          lastHeartbeat: new Date(),
          status: 'ONLINE',
          ipAddress: String(clientIp)
        },
        create: {
          serialNumber,
          name: `BioMax / eSSL Terminal (${serialNumber})`,
          status: 'ONLINE',
          ipAddress: String(clientIp),
          model: 'BioMax / eSSL ADMS'
        }
      });
      console.log(`✅ Device [${serialNumber}] marked ONLINE in database.`);
    }

    // Standard ZKTeco / BioMax / eSSL ADMS handshake response configuration.
    // Setting Stamp=0 & ATTLOGStamp=0 commands the device to flush all stored punches immediately.
    const responseConfig = [
      `GET OPTION FROM: ${serialNumber}`,
      `Stamp=0`,
      `OpStamp=0`,
      `PhotoStamp=0`,
      `ATTLOGStamp=0`,
      `OPERLOGStamp=0`,
      `BIODATAStamp=0`,
      `ErrorDelay=60`,
      `Delay=10`,
      `TransInterval=1`,
      `TransFlag=1111000000`,
      `TimeZone=330`,
      `Realtime=1`,
      `Encrypt=0`,
      `ServerVersion=3.4.1`,
      `PushProtVer=2.4.1`,
      `PushOptionsFlag=1`,
      `ServerName=ADMS Cloud Server`
    ].join('\n');

    res.set('Content-Type', 'text/plain');
    return res.status(200).send(responseConfig);
  } catch (error) {
    console.error('[ADMS GET Error]', error);
    res.set('Content-Type', 'text/plain');
    return res.status(200).send('OK');
  }
};

/**
 * POST /iclock/cdata or /cdata
 * Attendance Log (ATTLOG) & Device Data Push.
 * The machine pushes recorded punches, operator events, and device options here.
 */
export const handleCDataPost = async (req, res) => {
  try {
    const serialNumber = extractDeviceSN(req);
    const table = String(req.query.table || req.query.TableName || 'ATTLOG').toUpperCase();
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

    console.log(`==================== [ADMS DATA PUSH - POST /cdata] ====================`);
    console.log(`📡 Time:      ${new Date().toISOString()}`);
    console.log(`🔒 Device SN: ${serialNumber}`);
    console.log(`📋 Table:     ${table}`);
    console.log(`🌐 IP:        ${clientIp}`);
    console.log(`📦 Raw Payload:\n${rawBody.substring(0, 1000)}`);

    if (!serialNumber || serialNumber === 'UNKNOWN') {
      console.warn('⚠️ [ADMS POST] Missing Serial Number in request.');
      res.set('Content-Type', 'text/plain');
      return res.status(200).send('OK');
    }

    // 1. Lookup or auto-register the device in MongoDB via Prisma
    let device = await prisma.device.findUnique({
      where: { serialNumber },
      include: { company: true }
    });

    if (!device) {
      device = await prisma.device.create({
        data: {
          serialNumber,
          name: `Unassigned Terminal (${serialNumber})`,
          status: 'ONLINE',
          ipAddress: String(clientIp),
          lastHeartbeat: new Date()
        }
      });
      console.log(`🆕 [ADMS Auto-Register] Created new unassigned device [${serialNumber}].`);
    } else {
      await prisma.device.update({
        where: { id: device.id },
        data: {
          lastHeartbeat: new Date(),
          status: 'ONLINE',
          ipAddress: String(clientIp)
        }
      });
    }

    // 2. Handle non-ATTLOG tables (like OPERLOG, OPTIONS, BIOPHOTO)
    if (table === 'OPTIONS' || table === 'OPERLOG' || table === 'BIODATA') {
      console.log(`ℹ️ [ADMS POST] Acknowledged ${table} payload from SN: ${serialNumber}`);
      res.set('Content-Type', 'text/plain');
      return res.status(200).send('OK');
    }

    // 3. Multi-tenant verification: check if device is assigned to a company
    if (!device.companyId) {
      console.warn(`⚠️ [ADMS Tenant Warning] Device ${serialNumber} is not assigned to any Company. Punches acknowledged but unassigned.`);
      res.set('Content-Type', 'text/plain');
      return res.status(200).send('OK: 0');
    }

    // 4. Parse attendance records using the universal parser
    const parsedRecords = parseAdmsPayload(rawBody);
    console.log(`📊 [ADMS Parsed] Extracted ${parsedRecords.length} punch records for Company: ${device.company?.name || device.companyId}`);

    let savedCount = 0;

    for (const rec of parsedRecords) {
      // Find or auto-create Employee under this company tenant
      let employee = await prisma.employee.findUnique({
        where: {
          companyId_employeeId: {
            companyId: device.companyId,
            employeeId: rec.employeeId
          }
        }
      });

      if (!employee) {
        employee = await prisma.employee.create({
          data: {
            companyId: device.companyId,
            employeeId: rec.employeeId,
            name: `Employee #${rec.employeeId}`,
            department: 'Operations',
            designation: 'Staff'
          }
        });
        console.log(`👤 [ADMS Auto-Employee] Created staff record for Employee ID: ${rec.employeeId}`);
      }

      // Save AttendanceLog record isolated by companyId
      await prisma.attendanceLog.create({
        data: {
          companyId: device.companyId,
          employeeId: rec.employeeId,
          deviceSerial: serialNumber,
          deviceId: device.id,
          employeeDbId: employee.id,
          timestamp: rec.timestamp,
          state: rec.state,
          punchType: rec.punchType,
          rawData: rec.rawLine || rawBody
        }
      });

      savedCount++;
    }

    console.log(`✅ [ADMS Success] Successfully stored ${savedCount} attendance logs for Company [${device.company?.name}].`);

    // Standard BioMax & eSSL response format: "OK: <count>" or "OK"
    res.set('Content-Type', 'text/plain');
    return res.status(200).send(`OK: ${savedCount}`);
  } catch (error) {
    console.error('[ADMS POST Fatal Error]', error);
    res.set('Content-Type', 'text/plain');
    return res.status(200).send('OK');
  }
};

/**
 * GET /iclock/getrequest or /getrequest
 * Polling endpoint: device checks for pending remote commands (e.g. reboot, clear log, unlock door).
 * Returns 'OK' or an empty string when no commands are queued.
 */
export const handleGetRequest = async (req, res) => {
  try {
    const serialNumber = extractDeviceSN(req);
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

    if (serialNumber && serialNumber !== 'UNKNOWN') {
      await prisma.device.upsert({
        where: { serialNumber },
        update: {
          lastHeartbeat: new Date(),
          status: 'ONLINE',
          ipAddress: String(clientIp)
        },
        create: {
          serialNumber,
          name: `BioMax / eSSL Terminal (${serialNumber})`,
          status: 'ONLINE',
          ipAddress: String(clientIp),
          model: 'BioMax / eSSL ADMS'
        }
      });
    }
  } catch (err) {
    console.error('[handleGetRequest Error]', err);
  }

  res.set('Content-Type', 'text/plain');
  return res.status(200).send('OK');
};

/**
 * POST /iclock/devicecmd or /devicecmd
 * Device returns status code of an executed remote command.
 */
export const handleDeviceCmd = async (req, res) => {
  const serialNumber = extractDeviceSN(req);
  console.log(`[ADMS Command Response] Device SN: ${serialNumber} -> ${JSON.stringify(req.body || req.query)}`);
  res.set('Content-Type', 'text/plain');
  return res.status(200).send('OK');
};

/**
 * Generic handler for /iclock/fdata, /registry, /push, /ping
 */
export const handlePing = async (req, res) => {
  const serialNumber = extractDeviceSN(req);
  console.log(`[ADMS Ping] Route: ${req.method} ${req.originalUrl} from SN: ${serialNumber}`);
  res.set('Content-Type', 'text/plain');
  return res.status(200).send('OK');
};

/**
 * POST /api/adms/simulate
 * Built-in simulator endpoint allowing manual punch simulation for demos and tests
 */
export const simulatePush = async (req, res) => {
  try {
    const { serialNumber, punches } = req.body;

    if (!serialNumber) {
      return res.status(400).json({ error: 'serialNumber is required' });
    }

    const device = await prisma.device.findUnique({
      where: { serialNumber },
      include: { company: true }
    });

    if (!device) {
      return res.status(404).json({ error: `Device with serial number ${serialNumber} not found. Please register it first.` });
    }

    if (!device.companyId) {
      return res.status(400).json({ error: `Device ${serialNumber} is not assigned to a company.` });
    }

    const logsToCreate = [];
    const punchList = Array.isArray(punches) && punches.length > 0 ? punches : [
      {
        employeeId: '101',
        timestamp: new Date().toISOString(),
        state: 'CHECK_IN',
        punchType: 'FINGERPRINT'
      }
    ];

    for (const p of punchList) {
      // Upsert employee
      let employee = await prisma.employee.findUnique({
        where: {
          companyId_employeeId: {
            companyId: device.companyId,
            employeeId: String(p.employeeId)
          }
        }
      });

      if (!employee) {
        employee = await prisma.employee.create({
          data: {
            companyId: device.companyId,
            employeeId: String(p.employeeId),
            name: p.employeeName || `Employee #${p.employeeId}`,
            department: p.department || 'Operations',
            designation: p.designation || 'Staff'
          }
        });
      }

      const log = await prisma.attendanceLog.create({
        data: {
          companyId: device.companyId,
          employeeId: String(p.employeeId),
          deviceSerial: serialNumber,
          deviceId: device.id,
          employeeDbId: employee.id,
          timestamp: p.timestamp ? new Date(p.timestamp) : new Date(),
          state: p.state || 'CHECK_IN',
          punchType: p.punchType || 'FINGERPRINT',
          rawData: `SIMULATED: ${p.employeeId}\t${new Date().toISOString()}\t${p.state || 'CHECK_IN'}`
        },
        include: {
          employee: true,
          company: true,
          device: true
        }
      });

      logsToCreate.push(log);
    }

    // Update device heartbeat
    await prisma.device.update({
      where: { id: device.id },
      data: {
        lastHeartbeat: new Date(),
        status: 'ONLINE'
      }
    });

    return res.status(201).json({
      success: true,
      message: `Successfully simulated ${logsToCreate.length} attendance punch(es) from device ${serialNumber}`,
      createdLogs: logsToCreate
    });
  } catch (error) {
    console.error('[ADMS Simulate Error]', error);
    return res.status(500).json({ error: error.message || 'Failed to simulate device push' });
  }
};
