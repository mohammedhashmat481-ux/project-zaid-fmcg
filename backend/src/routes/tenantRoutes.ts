import { Router, Request, Response } from 'express';
import Organization from '../models/Organization';
import { authenticate } from '../middleware/authMiddleware';
import { requireTenant } from '../middleware/tenantMiddleware';
import { seedDatabase } from '../utils/seeder';

const router = Router();

// Helper to strip accidental localhost / 127.0.0.1 hostnames from saved URLs
const sanitizeFileUrl = (url?: string | null): string | undefined => {
  if (!url || typeof url !== 'string') return undefined;
  return url.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
};

// 1. Get branding settings (Public - called on application load)
router.get('/branding', async (req: Request, res: Response): Promise<void> => {
  try {
    const subdomain = req.query.subdomain as string;
    let tenantId = req.headers['x-tenant-id'] as string;
    let organization = null;

    if (tenantId) {
      organization = await Organization.findById(tenantId);
    } 
    
    if (!organization && subdomain) {
      organization = await Organization.findOne({ subdomain: subdomain.toLowerCase() });
    }

    if (!organization) {
      res.status(404).json({ error: 'Tenant profile not found.' });
      return;
    }

    res.status(200).json({
      id: organization._id,
      name: organization.name,
      subdomain: organization.subdomain,
      logoUrl: sanitizeFileUrl(organization.logoUrl),
      faviconUrl: sanitizeFileUrl(organization.faviconUrl),
      loginBgUrl: sanitizeFileUrl(organization.loginBgUrl),
      themeSettings: organization.themeSettings,
      enabledModules: organization.enabledModules,
      companyCode: organization.companyCode,
      registrationId: organization.registrationId,
      startDate: organization.startDate,
      endDate: organization.endDate,
      companyDocUrl: sanitizeFileUrl(organization.companyDocUrl),
      phoneNumber: organization.phoneNumber,
      mobile: organization.mobile,
      email: organization.email,
      fax: organization.fax,
      website: organization.website,
      currency: organization.currency || 'INR',
      address: organization.address,
      city: organization.city,
      state: organization.state,
      country: organization.country,
      postalCode: organization.postalCode,
      adminDetails: organization.adminDetails
    });
  } catch (error) {
    console.error('[BRANDING ERROR]', error);
    res.status(500).json({ error: 'Failed to retrieve branding profile.' });
  }
});

// 2. Update branding settings (Authenticated - Admin Only)
router.put('/branding', authenticate, requireTenant, async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name, themeSettings, logoUrl, faviconUrl, loginBgUrl,
      companyCode, registrationId, startDate, endDate, companyDocUrl,
      phoneNumber, mobile, email, fax, website, currency,
      address, city, state, country, postalCode,
      adminDetails
    } = req.body;

    const organization = await Organization.findById(req.organizationId);
    if (!organization) {
      res.status(404).json({ error: 'Organization not found.' });
      return;
    }

    if (name) organization.name = name;
    if (logoUrl !== undefined) organization.logoUrl = sanitizeFileUrl(logoUrl);
    if (faviconUrl !== undefined) organization.faviconUrl = sanitizeFileUrl(faviconUrl);
    if (loginBgUrl !== undefined) organization.loginBgUrl = sanitizeFileUrl(loginBgUrl);

    if (companyCode !== undefined) organization.companyCode = companyCode;
    if (registrationId !== undefined) organization.registrationId = registrationId;
    if (startDate !== undefined) organization.startDate = startDate;
    if (endDate !== undefined) organization.endDate = endDate;
    if (companyDocUrl !== undefined) organization.companyDocUrl = sanitizeFileUrl(companyDocUrl);
    if (phoneNumber !== undefined) organization.phoneNumber = phoneNumber;
    if (mobile !== undefined) organization.mobile = mobile;
    if (email !== undefined) organization.email = email;
    if (fax !== undefined) organization.fax = fax;
    if (website !== undefined) organization.website = website;
    if (currency !== undefined) organization.currency = currency;

    if (address !== undefined) organization.address = address;
    if (city !== undefined) organization.city = city;
    if (state !== undefined) organization.state = state;
    if (country !== undefined) organization.country = country;
    if (postalCode !== undefined) organization.postalCode = postalCode;

    if (adminDetails !== undefined) {
      organization.adminDetails = {
        ...organization.adminDetails,
        ...adminDetails
      };
    }

    if (themeSettings) {
      organization.themeSettings = {
        ...organization.themeSettings,
        ...themeSettings
      };
    }

    await organization.save();

    res.status(200).json({
      message: 'Branding specifications updated successfully.',
      branding: {
        id: organization._id,
        name: organization.name,
        logoUrl: sanitizeFileUrl(organization.logoUrl),
        faviconUrl: sanitizeFileUrl(organization.faviconUrl),
        loginBgUrl: sanitizeFileUrl(organization.loginBgUrl),
        themeSettings: organization.themeSettings,
        companyCode: organization.companyCode,
        registrationId: organization.registrationId,
        startDate: organization.startDate,
        endDate: organization.endDate,
        companyDocUrl: sanitizeFileUrl(organization.companyDocUrl),
        phoneNumber: organization.phoneNumber,
        mobile: organization.mobile,
        email: organization.email,
        fax: organization.fax,
        website: organization.website,
        currency: organization.currency || 'INR',
        address: organization.address,
        city: organization.city,
        state: organization.state,
        country: organization.country,
        postalCode: organization.postalCode,
        adminDetails: organization.adminDetails
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update branding settings.' });
  }
});

// 3. Re-seed database (Public - for easy testing/resetting in demo)
router.post('/seed-demo', async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('User requested manual database re-seeding...');
    await seedDatabase(false);
    res.status(200).json({ message: 'Database successfully seeded with demo organizations, modules, and records.' });
  } catch (error: any) {
    console.error('Failed to seed database:', error);
    res.status(500).json({ error: 'Failed to seed database: ' + error.message });
  }
});

export default router;
