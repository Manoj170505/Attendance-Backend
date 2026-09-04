import prisma from '../config/prisma.js';
import path from 'path';
import fs from 'fs';

/**
 * Helper to ensure a default company exists so punches and devices are never blocked
 */
export async function getOrCreateDefaultCompany() {
  let company = await prisma.company.findFirst();
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: 'Primary Organization',
        code: 'PRIMARY-ORG',
        description: 'Auto-provisioned default organization'
      }
    });
    console.log(`🏢 [AUTO-PROVISION] Created default company: ${company.name} (${company.code})`);
  }
  return company;
}

/**
 * Controller for Attendance Logs & Analytics
 */
export const getAttendanceLogs = async (req, res) => {
  try {
    const {
      companyId,
      employeeId,
      deviceSerial,
      startDate,
      endDate,
      state,
      limit = 100,
      page = 1
    } = req.query;

    const where = {};

    if (companyId) {
      where.companyId = companyId;
    }

    if (employeeId) {
      where.employeeId = employeeId;
    }

    if (deviceSerial) {
      where.deviceSerial = deviceSerial;
    }

    if (state) {
      where.state = state;
    }

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) {
        where.timestamp.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        if (endDate.length <= 10) {
          end.setHours(23, 59, 59, 999);
        }
        where.timestamp.lte = end;
      }
    }

    const take = Math.min(Number(limit) || 100, 500);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const [totalCount, logs] = await Promise.all([
      prisma.attendanceLog.count({ where }),
      prisma.attendanceLog.findMany({
        where,
        take,
        skip,
        orderBy: { timestamp: 'desc' },
        include: {
          company: {
            select: { id: true, name: true, code: true }
          },
          device: {
            select: { id: true, name: true, serialNumber: true, status: true }
          },
          employee: {
            select: { id: true, name: true, department: true, designation: true }
          }
        }
      })
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        total: totalCount,
        page: Number(page) || 1,
        limit: take,
        totalPages: Math.ceil(totalCount / take)
      },
      data: logs
    });
  } catch (error) {
    console.error('[getAttendanceLogs Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const getAttendanceStats = async (req, res) => {
  try {
    const { companyId } = req.query;

    const where = {};
    if (companyId) {
      where.companyId = companyId;
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const todayWhere = {
      ...where,
      timestamp: {
        gte: startOfToday,
        lte: endOfToday
      }
    };

    const [
      totalTodayPunches,
      totalCompanies,
      totalDevices,
      totalEmployees,
      recentLogs
    ] = await Promise.all([
      prisma.attendanceLog.count({ where: todayWhere }),
      prisma.company.count(),
      prisma.device.count(companyId ? { where: { companyId } } : {}),
      prisma.employee.count(companyId ? { where: { companyId } } : {}),
      prisma.attendanceLog.findMany({
        where,
        take: 10,
        orderBy: { timestamp: 'desc' },
        include: {
          company: { select: { name: true } },
          employee: { select: { name: true, department: true } },
          device: { select: { name: true, serialNumber: true } }
        }
      })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalTodayPunches,
        totalCompanies,
        totalDevices,
        totalEmployees,
        recentLogs
      }
    });
  } catch (error) {
    console.error('[getAttendanceStats Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get latest recorded punch timestamp for a device serial
 * Used by sync agents to perform cursor-based incremental sync
 * GET /api/attendance/latest-timestamp
 */
export const getLatestPunchTimestamp = async (req, res) => {
  try {
    const { deviceSerial } = req.query;
    const where = deviceSerial ? { deviceSerial } : {};
    const latestLog = await prisma.attendanceLog.findFirst({
      where,
      orderBy: { timestamp: 'desc' }
    });

    return res.status(200).json({
      success: true,
      latestTimestamp: latestLog ? latestLog.timestamp.toISOString() : null
    });
  } catch (error) {
    console.error('[getLatestPunchTimestamp Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Direct REST API for Local Sync Agents / Hardware Bridges
 * POST /api/attendance/punch
 */
export const recordPunch = async (req, res) => {
  try {
    const { deviceSerial, employeeId, timestamp, state, punchType, rawData } = req.body;

    if (!deviceSerial || !employeeId) {
      return res.status(400).json({ success: false, error: 'deviceSerial and employeeId are required' });
    }

    const defaultCompany = await getOrCreateDefaultCompany();

    // Lookup or auto-register device
    let device = await prisma.device.findUnique({
      where: { serialNumber: deviceSerial },
      include: { company: true }
    });

    if (!device) {
      device = await prisma.device.create({
        data: {
          serialNumber: deviceSerial,
          name: `Terminal (${deviceSerial})`,
          companyId: defaultCompany.id,
          status: 'ONLINE',
          lastHeartbeat: new Date()
        },
        include: { company: true }
      });
    } else {
      const updateData = {
        status: 'ONLINE',
        lastHeartbeat: new Date()
      };
      if (!device.companyId) {
        updateData.companyId = defaultCompany.id;
      }
      device = await prisma.device.update({
        where: { id: device.id },
        data: updateData,
        include: { company: true }
      });
    }

    const activeCompanyId = device.companyId || defaultCompany.id;
    const punchDate = timestamp ? new Date(timestamp) : new Date();

    // 1. DEDUPLICATION: Check if this identical punch was already registered
    const existingLog = await prisma.attendanceLog.findFirst({
      where: {
        companyId: activeCompanyId,
        deviceSerial,
        employeeId: String(employeeId),
        timestamp: punchDate
      },
      include: {
        employee: true,
        company: true,
        device: true
      }
    });

    if (existingLog) {
      return res.status(200).json({
        success: true,
        message: 'Punch already registered (duplicate skipped)',
        data: existingLog,
        isDuplicate: true
      });
    }

    // 2. Upsert Employee
    let employee = await prisma.employee.findUnique({
      where: {
        companyId_employeeId: {
          companyId: activeCompanyId,
          employeeId: String(employeeId)
        }
      }
    });

    if (!employee) {
      employee = await prisma.employee.create({
        data: {
          companyId: activeCompanyId,
          employeeId: String(employeeId),
          name: `Employee #${employeeId}`,
          department: 'General',
          designation: 'Staff'
        }
      });
    }

    // 3. Create Attendance Log
    const log = await prisma.attendanceLog.create({
      data: {
        companyId: activeCompanyId,
        employeeId: String(employeeId),
        deviceSerial,
        deviceId: device.id,
        employeeDbId: employee.id,
        timestamp: punchDate,
        state: state || 'CHECK_IN',
        punchType: punchType || 'FINGERPRINT',
        rawData: rawData || `AGENT: ${employeeId}\t${punchDate.toISOString()}\t${state || 'CHECK_IN'}`
      },
      include: {
        employee: true,
        company: true,
        device: true
      }
    });

    console.log(`📡 [PUNCH SAVED] Employee #${employeeId} (${state || 'CHECK_IN'}) at Device [${deviceSerial}]`);

    return res.status(201).json({
      success: true,
      message: 'Punch recorded successfully',
      data: log,
      isDuplicate: false
    });
  } catch (error) {
    console.error('[recordPunch Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Sync Enrolled Users & Names from Biometric Hardware
 * POST /api/attendance/sync-users
 */
export const syncDeviceUsers = async (req, res) => {
  try {
    const { deviceSerial, users } = req.body;

    if (!deviceSerial || !Array.isArray(users)) {
      return res.status(400).json({ success: false, error: 'deviceSerial and users array are required' });
    }

    const defaultCompany = await getOrCreateDefaultCompany();

    // Lookup device
    let device = await prisma.device.findUnique({
      where: { serialNumber: deviceSerial },
      include: { company: true }
    });

    if (!device) {
      device = await prisma.device.create({
        data: {
          serialNumber: deviceSerial,
          name: `Terminal (${deviceSerial})`,
          companyId: defaultCompany.id,
          status: 'ONLINE',
          lastHeartbeat: new Date()
        },
        include: { company: true }
      });
    } else {
      const updateData = {
        status: 'ONLINE',
        lastHeartbeat: new Date()
      };
      if (!device.companyId) {
        updateData.companyId = defaultCompany.id;
      }
      device = await prisma.device.update({
        where: { id: device.id },
        data: updateData,
        include: { company: true }
      });
    }

    const activeCompanyId = device.companyId || defaultCompany.id;
    let syncedCount = 0;

    for (const u of users) {
      const cleanEmpId = String(u.employeeId || u.userId || u.uid || '').trim();
      if (!cleanEmpId) continue;

      let cleanName = u.name ? String(u.name).replace(/\0/g, '').trim() : '';
      if (!cleanName) {
        cleanName = `Employee #${cleanEmpId}`;
      }

      const cardNo = u.cardNo || u.cardno ? String(u.cardNo || u.cardno).trim() : null;

      const existing = await prisma.employee.findUnique({
        where: {
          companyId_employeeId: {
            companyId: activeCompanyId,
            employeeId: cleanEmpId
          }
        }
      });

      if (existing) {
        const shouldUpdateName = !cleanName.startsWith('Employee #') || existing.name.startsWith('Employee #');
        await prisma.employee.update({
          where: { id: existing.id },
          data: {
            ...(shouldUpdateName ? { name: cleanName } : {}),
            ...(cardNo && cardNo !== '0' ? { cardNo } : {})
          }
        });
      } else {
        await prisma.employee.create({
          data: {
            companyId: activeCompanyId,
            employeeId: cleanEmpId,
            name: cleanName,
            department: 'Operations',
            designation: 'Staff',
            cardNo: cardNo && cardNo !== '0' ? cardNo : null
          }
        });
      }

      syncedCount++;
    }

    console.log(`👥 [USER SYNC] Synced ${syncedCount} enrolled employee profiles from Device [${deviceSerial}]`);

    return res.status(200).json({
      success: true,
      count: syncedCount,
      message: `Successfully synced ${syncedCount} user profiles from device ${deviceSerial}`
    });
  } catch (error) {
    console.error('[syncDeviceUsers Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Direct file download endpoint for agent.js
 * GET /download/agent.js or GET /api/attendance/download-agent
 */
export const downloadAgentScript = async (req, res) => {
  try {
    const searchPaths = [
      path.join(process.cwd(), 'agent.js'),
      path.join(process.cwd(), '../agent/agent.js'),
      path.join(process.cwd(), 'src/agent.js')
    ];

    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Content-Disposition', 'attachment; filename="agent.js"');
        return res.sendFile(path.resolve(p));
      }
    }
    return res.status(404).send('agent.js file not found on server');
  } catch (err) {
    return res.status(500).send(err.message);
  }
};
