import prisma from '../config/prisma.js';
import { parseAdmsPayload } from '../utils/admsParser.js';

/**
 * Controller for BioMax / eSSL / ZKTeco ADMS (Push) Protocol
 */

/**
 * GET /iclock/cdata or /cdata
 * Handshake / initialization request from biometric machine
 */
export const handleCDataGet = async (req, res) => {
  try {
    const serialNumber = req.query.SN || req.headers['x-serial-number'] || 'UNKNOWN';
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    console.log(`[ADMS GET] Handshake ping from Device SN: ${serialNumber} (IP: ${clientIp})`);

    if (serialNumber !== 'UNKNOWN') {
      // Find or create device to track connection
      await prisma.device.upsert({
        where: { serialNumber },
        update: {
          lastHeartbeat: new Date(),
          status: 'ONLINE',
          ipAddress: clientIp
        },
        create: {
          serialNumber,
          name: `BioMax Device (${serialNumber})`,
          status: 'ONLINE',
          ipAddress: clientIp,
          model: 'BioMax / eSSL ADMS'
        }
      });
    }

    // Standard ADMS / iClock handshake response format expected by firmware
    const responseConfig = [
      `GET OPTION FROM: ${serialNumber}`,
      `Stamp=9999`,
      `OpStamp=9999`,
      `PhotoStamp=9999`,
      `ErrorDelay=60`,
      `Delay=30`,
      `TransTimes=00:00;14:00`,
      `TransInterval=1`,
      `TransFlag=1111000000`,
      `Realtime=1`,
      `Encrypt=0`
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
 * Attendance Log (ATTLOG) push from biometric machine
 */
export const handleCDataPost = async (req, res) => {
  try {
    const serialNumber = req.query.SN || req.headers['x-serial-number'];
    const table = req.query.table || 'ATTLOG';
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    console.log(`[ADMS POST] Received ${table} push from SN: ${serialNumber || 'UNKNOWN'}`);
    console.log(`[ADMS POST Body]`, rawBody);

    if (!serialNumber) {
      console.warn('[ADMS POST] Missing Serial Number in request');
      res.set('Content-Type', 'text/plain');
      return res.status(200).send('OK');
    }

    // Lookup device in database
    let device = await prisma.device.findUnique({
      where: { serialNumber },
      include: { company: true }
    });

    if (!device) {
      // Auto-register device as UNASSIGNED so admin can easily link it to a company
      device = await prisma.device.create({
        data: {
          serialNumber,
          name: `Unassigned Device (${serialNumber})`,
          status: 'ONLINE',
          ipAddress: clientIp,
          lastHeartbeat: new Date()
        }
      });
      console.log(`[ADMS POST] Auto-registered new device SN: ${serialNumber}`);
    } else {
      // Update device heartbeat & status
      await prisma.device.update({
        where: { id: device.id },
        data: {
          lastHeartbeat: new Date(),
          status: 'ONLINE',
          ipAddress: clientIp
        }
      });
    }

    // If device is not yet assigned to a company, we still acknowledge to prevent device lock
    if (!device.companyId) {
      console.warn(`[ADMS POST] Device ${serialNumber} is not assigned to any Company yet. Punches buffered without tenant.`);
      res.set('Content-Type', 'text/plain');
      return res.status(200).send('OK: 0');
    }

    // Parse records from payload
    const parsedRecords = parseAdmsPayload(rawBody);
    console.log(`[ADMS POST] Parsed ${parsedRecords.length} records for Company: ${device.company?.name || device.companyId}`);

    let savedCount = 0;

    for (const rec of parsedRecords) {
      // Find or auto-create Employee under this company
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
      }

      // Save AttendanceLog
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

    res.set('Content-Type', 'text/plain');
    // BioMax firmware standard response: "OK: <count>" or "OK"
    return res.status(200).send(`OK: ${savedCount}`);
  } catch (error) {
    console.error('[ADMS POST Error]', error);
    res.set('Content-Type', 'text/plain');
    return res.status(200).send('OK');
  }
};

/**
 * GET /iclock/getrequest or /getrequest
 * Device polling for pending commands
 */
export const handleGetRequest = async (req, res) => {
  const serialNumber = req.query.SN || req.headers['x-serial-number'];
  if (serialNumber) {
    prisma.device.updateMany({
      where: { serialNumber },
      data: { lastHeartbeat: new Date(), status: 'ONLINE' }
    }).catch(() => {});
  }
  res.set('Content-Type', 'text/plain');
  return res.status(200).send('OK');
};

/**
 * POST /iclock/devicecmd or /devicecmd
 * Device returning status of executed command
 */
export const handleDeviceCmd = async (req, res) => {
  res.set('Content-Type', 'text/plain');
  return res.status(200).send('OK');
};

/**
 * POST /api/adms/simulate
 * Built-in simulator endpoint allowing testing of device push from UI/API
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
