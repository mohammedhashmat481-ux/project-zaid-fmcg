"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireTenant = exports.resolveTenant = void 0;
const Organization_1 = __importDefault(require("../models/Organization"));
const PgModel_1 = require("../models/PgModel");
const resolveTenant = async (req, res, next) => {
    try {
        let tenantIdentifier = req.headers['x-tenant-id'];
        let organization = null;
        // 1. Try to resolve by tenant ID header
        if (tenantIdentifier && PgModel_1.PgObjectId.isValid(tenantIdentifier)) {
            organization = await Organization_1.default.findById(tenantIdentifier);
        }
        // 2. Try to resolve by subdomain from Host header if not resolved
        if (!organization) {
            const host = req.headers.host || '';
            // sales.localhost:5000 -> ["sales", "localhost:5000"]
            const parts = host.split('.');
            if (parts.length > 1 && parts[0] !== 'www' && parts[0] !== 'localhost') {
                const subdomain = parts[0].toLowerCase();
                organization = await Organization_1.default.findOne({ subdomain });
            }
        }
        // 3. Fallback: try checking a query param or request body
        if (!organization && req.query.tenantId && typeof req.query.tenantId === 'string' && PgModel_1.PgObjectId.isValid(req.query.tenantId)) {
            organization = await Organization_1.default.findById(req.query.tenantId);
        }
        if (!organization) {
            // If we are hit from a public route (e.g., auth login/register) we might not have tenant yet
            // but if the route requires a tenant context, we throw.
            // We will allow continuing, but route handlers will check if req.organizationId is set.
            return next();
        }
        req.organizationId = String(organization._id);
        next();
    }
    catch (error) {
        console.error('Error resolving tenant:', error);
        res.status(500).json({ error: 'Internal server error resolving tenant.' });
    }
};
exports.resolveTenant = resolveTenant;
// Middleware to force a tenant to be loaded for protected tenant routes
const requireTenant = (req, res, next) => {
    if (!req.organizationId) {
        res.status(400).json({ error: 'Tenant context (x-tenant-id header or subdomain) is required for this operation.' });
        return;
    }
    next();
};
exports.requireTenant = requireTenant;
