import prisma from '../config/prisma.js';

export const getAllCompanies = async (req, res) => {
  try {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            devices: true,
            employees: true,
            attendanceLogs: true
          }
        }
      }
    });

    return res.status(200).json({ success: true, data: companies });
  } catch (error) {
    console.error('[getAllCompanies Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const getCompanyById = async (req, res) => {
  try {
    const { id } = req.params;
    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        devices: true,
        _count: {
          select: { employees: true, attendanceLogs: true }
        }
      }
    });

    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    return res.status(200).json({ success: true, data: company });
  } catch (error) {
    console.error('[getCompanyById Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const createCompany = async (req, res) => {
  try {
    const { name, code, description } = req.body;

    if (!name || !code) {
      return res.status(400).json({ success: false, error: 'Name and unique Company Code are required' });
    }

    const normalizedCode = code.trim().toUpperCase();

    const existing = await prisma.company.findUnique({
      where: { code: normalizedCode }
    });

    if (existing) {
      return res.status(400).json({ success: false, error: `Company code '${normalizedCode}' already exists` });
    }

    const newCompany = await prisma.company.create({
      data: {
        name: name.trim(),
        code: normalizedCode,
        description: description ? description.trim() : null
      }
    });

    return res.status(201).json({ success: true, data: newCompany });
  } catch (error) {
    console.error('[createCompany Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const updateCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const updated = await prisma.company.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(description !== undefined && { description: description ? description.trim() : null })
      }
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('[updateCompany Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteCompany = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.company.delete({
      where: { id }
    });

    return res.status(200).json({ success: true, message: 'Company and associated data deleted' });
  } catch (error) {
    console.error('[deleteCompany Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
