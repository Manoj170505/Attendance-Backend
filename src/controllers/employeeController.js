import prisma from '../config/prisma.js';

export const getEmployees = async (req, res) => {
  try {
    const { companyId } = req.query;

    const where = {};
    if (companyId) {
      where.companyId = companyId;
    }

    const employees = await prisma.employee.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        company: {
          select: { id: true, name: true, code: true }
        },
        _count: {
          select: { attendanceLogs: true }
        }
      }
    });

    return res.status(200).json({ success: true, data: employees });
  } catch (error) {
    console.error('[getEmployees Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const createEmployee = async (req, res) => {
  try {
    const { companyId, employeeId, name, department, designation, cardNo } = req.body;

    if (!companyId || !employeeId || !name) {
      return res.status(400).json({ success: false, error: 'companyId, employeeId (Device User ID), and name are required' });
    }

    const cleanEmpId = String(employeeId).trim();

    // Check duplicate under the same company
    const existing = await prisma.employee.findUnique({
      where: {
        companyId_employeeId: {
          companyId,
          employeeId: cleanEmpId
        }
      }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: `Employee with Device User ID '${cleanEmpId}' already exists in this company.`
      });
    }

    const newEmp = await prisma.employee.create({
      data: {
        companyId,
        employeeId: cleanEmpId,
        name: name.trim(),
        department: department ? department.trim() : 'Operations',
        designation: designation ? designation.trim() : 'Staff',
        cardNo: cardNo ? cardNo.trim() : null
      },
      include: { company: true }
    });

    return res.status(201).json({ success: true, data: newEmp });
  } catch (error) {
    console.error('[createEmployee Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, department, designation, cardNo } = req.body;

    const updated = await prisma.employee.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(department !== undefined && { department: department ? department.trim() : null }),
        ...(designation !== undefined && { designation: designation ? designation.trim() : null }),
        ...(cardNo !== undefined && { cardNo: cardNo ? cardNo.trim() : null })
      }
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('[updateEmployee Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.employee.delete({
      where: { id }
    });

    return res.status(200).json({ success: true, message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('[deleteEmployee Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
