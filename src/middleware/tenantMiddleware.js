import prisma from '../config/prisma.js';

/**
 * Optional Tenant Isolation Middleware.
 * Extracts `x-company-id` header or `companyId` query param.
 */
export const validateTenant = async (req, res, next) => {
  const companyId = req.headers['x-company-id'] || req.query.companyId;

  if (companyId) {
    try {
      const company = await prisma.company.findUnique({
        where: { id: companyId }
      });
      if (!company) {
        return res.status(404).json({ success: false, error: 'Tenant company not found' });
      }
      req.company = company;
    } catch (err) {
      return res.status(400).json({ success: false, error: 'Invalid Company ID format' });
    }
  }

  next();
};
