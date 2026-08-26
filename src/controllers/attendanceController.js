import prisma from '../config/prisma.js';

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
        // Set end of day if only date is passed
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

    // Calculate today's start and end timestamps in UTC/local
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
