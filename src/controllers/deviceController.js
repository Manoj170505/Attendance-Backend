import prisma from '../config/prisma.js';

export const getDevices = async (req, res) => {
  try {
    const { companyId } = req.query;

    const where = {};
    if (companyId) {
      where.companyId = companyId;
    }

    const devices = await prisma.device.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        company: {
          select: { id: true, name: true, code: true }
        },
        _count: {
          select: { attendanceLogs: true }
        }
      }
    });

    // Check online status based on last heartbeat (e.g. within last 3 minutes)
    const thresholdMinutes = 3;
    const now = new Date();

    const formatted = devices.map(d => {
      let liveStatus = d.status;
      if (d.lastHeartbeat) {
        const diffMinutes = (now - new Date(d.lastHeartbeat)) / (1000 * 60);
        liveStatus = diffMinutes <= thresholdMinutes ? 'ONLINE' : 'OFFLINE';
      } else {
        liveStatus = 'OFFLINE';
      }
      return {
        ...d,
        computedStatus: liveStatus
      };
    });

    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error('[getDevices Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const registerDevice = async (req, res) => {
  try {
    const { serialNumber, name, companyId, model } = req.body;

    if (!serialNumber) {
      return res.status(400).json({ success: false, error: 'Device Serial Number (SN) is required' });
    }

    const cleanSN = serialNumber.trim();

    // Check if already exists
    const existing = await prisma.device.findUnique({
      where: { serialNumber: cleanSN }
    });

    if (existing) {
      // If exists and was unassigned, we can update the company
      const updated = await prisma.device.update({
        where: { serialNumber: cleanSN },
        data: {
          name: name ? name.trim() : existing.name,
          companyId: companyId || existing.companyId,
          model: model || existing.model
        },
        include: { company: true }
      });
      return res.status(200).json({ success: true, message: 'Device updated', data: updated });
    }

    const newDevice = await prisma.device.create({
      data: {
        serialNumber: cleanSN,
        name: name ? name.trim() : `BioMax (${cleanSN})`,
        companyId: companyId || null,
        model: model || 'BioMax / eSSL ADMS',
        status: 'OFFLINE'
      },
      include: { company: true }
    });

    return res.status(201).json({ success: true, data: newDevice });
  } catch (error) {
    console.error('[registerDevice Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const updateDevice = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, companyId, model, status } = req.body;

    const updated = await prisma.device.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(companyId !== undefined && { companyId: companyId || null }),
        ...(model && { model }),
        ...(status && { status })
      },
      include: { company: true }
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('[updateDevice Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteDevice = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.device.delete({
      where: { id }
    });

    return res.status(200).json({ success: true, message: 'Device deleted successfully' });
  } catch (error) {
    console.error('[deleteDevice Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
