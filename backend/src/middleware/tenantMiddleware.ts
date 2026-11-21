import { Request, Response, NextFunction } from 'express';
import Organization from '../models/Organization';
import { PgObjectId } from '../models/PgModel';
import { serverCache, CacheKeys } from '../utils/cache';

const TENANT_CACHE_TTL = 600; // 10 minutes in-memory cache

export const resolveTenant = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let tenantIdentifier = req.headers['x-tenant-id'] as string;
    let organizationId: string | null = null;

    // 1. Try to resolve by tenant ID header
    if (tenantIdentifier && PgObjectId.isValid(tenantIdentifier)) {
      const cacheKey = CacheKeys.tenantById(tenantIdentifier);
      const cachedId = serverCache.get<string>(cacheKey);
      if (cachedId) {
        organizationId = cachedId;
      } else {
        const org = await Organization.findById(tenantIdentifier).select('_id subdomain').lean();
        if (org) {
          organizationId = String(org._id || org.id);
          serverCache.set(cacheKey, organizationId, TENANT_CACHE_TTL);
          if (org.subdomain) {
            serverCache.set(CacheKeys.tenantBySubdomain(org.subdomain), organizationId, TENANT_CACHE_TTL);
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
        const cacheKey = CacheKeys.tenantBySubdomain(subdomain);
        const cachedId = serverCache.get<string>(cacheKey);
        if (cachedId) {
          organizationId = cachedId;
        } else {
          const org = await Organization.findOne({ subdomain }).select('_id subdomain').lean();
          if (org) {
            organizationId = String(org._id || org.id);
            serverCache.set(cacheKey, organizationId, TENANT_CACHE_TTL);
            serverCache.set(CacheKeys.tenantById(organizationId), organizationId, TENANT_CACHE_TTL);
          }
        }
      }
    }

    // 3. Fallback: try checking a query param or request body
    if (!organizationId && req.query.tenantId && typeof req.query.tenantId === 'string' && PgObjectId.isValid(req.query.tenantId)) {
      const paramTenantId = req.query.tenantId;
      const cacheKey = CacheKeys.tenantById(paramTenantId);
      const cachedId = serverCache.get<string>(cacheKey);
      if (cachedId) {
        organizationId = cachedId;
      } else {
        const org = await Organization.findById(paramTenantId).select('_id subdomain').lean();
        if (org) {
          organizationId = String(org._id || org.id);
          serverCache.set(cacheKey, organizationId, TENANT_CACHE_TTL);
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
  } catch (error) {
    console.error('Error resolving tenant:', error);
    res.status(500).json({ error: 'Internal server error resolving tenant.' });
  }
};

// Middleware to force a tenant to be loaded for protected tenant routes
export const requireTenant = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.organizationId) {
    res.status(400).json({ error: 'Tenant context (x-tenant-id header or subdomain) is required for this operation.' });
    return;
  }
  next();
};
