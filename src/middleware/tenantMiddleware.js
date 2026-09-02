import prisma from '../config/prisma.js';

/**
 * Strict Tenant Isolation Middleware.
 * Rejects requests if companyId header/query is missing.
 */
export const requireTenant = async (req, res, next) => {
  const companyId = req.headers['x-company-id'] || req.query.companyId;

  if (!companyId) {
    return res.status(400).json({ success: false, error: 'Company ID (x-company-id header or query) is required for this route' });
  }

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId }
    });

    if (!company) {
      return res.status(404).json({ success: false, error: 'Tenant company not found' });
    }

    req.company = company;
    next();
  } catch (err) {
    return res.status(400).json({ success: false, error: 'Invalid Company ID format' });
  }
};