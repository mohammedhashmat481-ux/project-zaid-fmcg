"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireTenant = exports.resolveTenant = void 0;
const Organization_1 = __importDefault(require("../models/Organization"));
const PgModel_1 = require("../models/PgModel");
const cache_1 = require("../utils/cache");
const TENANT_CACHE_TTL = 600; // 10 minutes in-memory cache
const resolveTenant = async (req, res, next) => {
    try {
        let tenantIdentifier = req.headers['x-tenant-id'];
        let organizationId = null;
        // 1. Try to resolve by tenant ID header
        if (tenantIdentifier && PgModel_1.PgObjectId.isValid(tenantIdentifier)) {
            const cacheKey = cache_1.CacheKeys.tenantById(tenantIdentifier);
            const cachedId = cache_1.serverCache.get(cacheKey);
            if (cachedId) {
                organizationId = cachedId;
            }
            else {
                const org = await Organization_1.default.findById(tenantIdentifier).select('_id subdomain').lean();
                if (org) {
                    organizationId = String(org._id || org.id);
                    cache_1.serverCache.set(cacheKey, organizationId, TENANT_CACHE_TTL);
                    if (org.subdomain) {
                        cache_1.serverCache.set(cache_1.CacheKeys.tenantBySubdomain(org.subdomain), organizationId, TENANT_CACHE_TTL);
                    }
                }
            }
        }
        // 2. Try to resolve by subdomain from Host header if not resolved
        if (!organizationId) {
            const host = req.headers.host || '';
            // sales.localhost:5000 -> ["sales", "localhost:5000"]
            const parts = host.split('.');
            if (parts.length > 1 && parts[0] !== 'www' && parts[0] !== 'localhost') {
                const subdomain = parts[0].toLowerCase();
                const cacheKey = cache_1.CacheKeys.tenantBySubdomain(subdomain);
                const cachedId = cache_1.serverCache.get(cacheKey);
                if (cachedId) {
                    organizationId = cachedId;
                }
                else {
                    const org = await Organization_1.default.findOne({ subdomain }).select('_id subdomain').lean();
                    if (org) {
                        organizationId = String(org._id || org.id);
                        cache_1.serverCache.set(cacheKey, organizationId, TENANT_CACHE_TTL);
                        cache_1.serverCache.set(cache_1.CacheKeys.tenantById(organizationId), organizationId, TENANT_CACHE_TTL);
                    }
                }
            }
        }
        // 3. Fallback: try checking a query param or request body
        if (!organizationId && req.query.tenantId && typeof req.query.tenantId === 'string' && PgModel_1.PgObjectId.isValid(req.query.tenantId)) {
            const paramTenantId = req.query.tenantId;
            const cacheKey = cache_1.CacheKeys.tenantById(paramTenantId);
            const cachedId = cache_1.serverCache.get(cacheKey);
            if (cachedId) {
                organizationId = cachedId;
            }
            else {
                const org = await Organization_1.default.findById(paramTenantId).select('_id subdomain').lean();
                if (org) {
                    organizationId = String(org._id || org.id);
                    cache_1.serverCache.set(cacheKey, organizationId, TENANT_CACHE_TTL);
                }
            }
        }
        if (!organizationId) {
            // If we are hit from a public route (e.g., auth login/register) we might not have tenant yet
            // but if the route requires a tenant context, we throw.
            // We will allow continuing, but route handlers will check if req.organizationId is set.
            return next();
        }
        req.organizationId = organizationId;
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
