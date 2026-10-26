"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Organization_1 = __importDefault(require("../models/Organization"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const seedDemoData_1 = require("../utils/seedDemoData");
const router = (0, express_1.Router)();
// Helper to strip accidental localhost / 127.0.0.1 hostnames from saved URLs
const sanitizeFileUrl = (url) => {
    if (!url || typeof url !== 'string')
        return undefined;
    return url.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
};
// 1. Get branding settings (Public - called on application load)
router.get('/branding', async (req, res) => {
    try {
        const subdomain = req.query.subdomain;
        let tenantId = req.headers['x-tenant-id'];
        let organization = null;
        if (tenantId) {
            organization = await Organization_1.default.findById(tenantId);
        }
        if (!organization && subdomain) {
            organization = await Organization_1.default.findOne({ subdomain: subdomain.toLowerCase() });
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
    }
    catch (error) {
        console.error('[BRANDING ERROR]', error);
        res.status(500).json({ error: 'Failed to retrieve branding profile.' });
    }
});
// 2. Update branding settings (Authenticated - Admin Only)
router.put('/branding', authMiddleware_1.authenticate, tenantMiddleware_1.requireTenant, async (req, res) => {
    try {
        const { name, themeSettings, logoUrl, faviconUrl, loginBgUrl, companyCode, registrationId, startDate, endDate, companyDocUrl, phoneNumber, mobile, email, fax, website, currency, address, city, state, country, postalCode, adminDetails } = req.body;
        const organization = await Organization_1.default.findById(req.organizationId);
        if (!organization) {
            res.status(404).json({ error: 'Organization not found.' });
            return;
        }
        if (name)
            organization.name = name;
        if (logoUrl !== undefined)
            organization.logoUrl = sanitizeFileUrl(logoUrl);
        if (faviconUrl !== undefined)
            organization.faviconUrl = sanitizeFileUrl(faviconUrl);
        if (loginBgUrl !== undefined)
            organization.loginBgUrl = sanitizeFileUrl(loginBgUrl);
        if (companyCode !== undefined)
            organization.companyCode = companyCode;
        if (registrationId !== undefined)
            organization.registrationId = registrationId;
        if (startDate !== undefined)
            organization.startDate = startDate;
        if (endDate !== undefined)
            organization.endDate = endDate;
        if (companyDocUrl !== undefined)
            organization.companyDocUrl = sanitizeFileUrl(companyDocUrl);
        if (phoneNumber !== undefined)
            organization.phoneNumber = phoneNumber;
        if (mobile !== undefined)
            organization.mobile = mobile;
        if (email !== undefined)
            organization.email = email;
        if (fax !== undefined)
            organization.fax = fax;
        if (website !== undefined)
            organization.website = website;
        if (currency !== undefined)
            organization.currency = currency;
        if (address !== undefined)
            organization.address = address;
        if (city !== undefined)
            organization.city = city;
        if (state !== undefined)
            organization.state = state;
        if (country !== undefined)
            organization.country = country;
        if (postalCode !== undefined)
            organization.postalCode = postalCode;
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
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update branding settings.' });
    }
});
// 3. Re-seed database (Public - for easy testing/resetting in demo)
router.post('/seed-demo', async (req, res) => {
    try {
        console.log('User requested manual database re-seeding...');
        await (0, seedDemoData_1.seedDemoData)();
        res.status(200).json({ message: 'Database successfully seeded with demo organizations, modules, users, campaigns, leads, and reports.' });
    }
    catch (error) {
        console.error('Failed to seed database:', error);
        res.status(500).json({ error: 'Failed to seed database: ' + error.message });
    }
});
exports.default = router;
