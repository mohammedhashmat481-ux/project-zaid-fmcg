"use strict";
// inkCRM In-Memory High-Performance TTL Cache Engine
// Zero-dependency, lightweight, LRU-bounded, thread-safe for Node.js event loop
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheInvalidators = exports.CacheKeys = exports.serverCache = void 0;
class MemoryCache {
    store = new Map();
    cleanupInterval = null;
    maxSize;
    constructor(maxSize = 2500) {
        this.maxSize = process.env.CACHE_MAX_ENTRIES ? Math.max(10, parseInt(process.env.CACHE_MAX_ENTRIES, 10)) : maxSize;
        // Run cleanup every 60 seconds
        this.cleanupInterval = setInterval(() => {
            this.purgeExpired();
        }, 60000);
        // Don't keep the process alive just for the cleanup timer
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        // LRU promotion: re-insert so key becomes most-recently used
        this.store.delete(key);
        this.store.set(key, entry);
        return entry.value;
    }
    set(key, value, ttlSeconds) {
        if (this.store.has(key)) {
            this.store.delete(key);
        }
        else if (this.store.size >= this.maxSize) {
            // Evict least-recently used entry (first entry in Map)
            const oldestKey = this.store.keys().next().value;
            if (oldestKey !== undefined) {
                this.store.delete(oldestKey);
            }
        }
        this.store.set(key, {
            value,
            expiresAt: Date.now() + ttlSeconds * 1000
        });
    }
    delete(key) {
        return this.store.delete(key);
    }
    /**
     * Invalidate all keys matching a prefix or regex pattern
     */
    invalidatePattern(prefixOrPattern) {
        let deleted = 0;
        const isRegex = prefixOrPattern instanceof RegExp;
        for (const key of this.store.keys()) {
            const match = isRegex
                ? prefixOrPattern.test(key)
                : key.startsWith(prefixOrPattern);
            if (match) {
                this.store.delete(key);
                deleted++;
            }
        }
        return deleted;
    }
    /**
     * Clear all entries
     */
    clear() {
        this.store.clear();
    }
    /**
     * Purge expired items
     */
    purgeExpired() {
        const now = Date.now();
        for (const [key, entry] of this.store.entries()) {
            if (now > entry.expiresAt) {
                this.store.delete(key);
            }
        }
    }
    /**
     * Get cache diagnostics / statistics
     */
    stats() {
        return {
            size: this.store.size,
            maxSize: this.maxSize,
            uptime: process.uptime()
        };
    }
}
exports.serverCache = new MemoryCache();
// Helpers for specific cache domains
exports.CacheKeys = {
    dashboardMetrics: (orgId, userKey) => `dash:metrics:${orgId}:${userKey}`,
    statuses: (orgId) => `master:statuses:${orgId}`,
    modules: (orgId) => `master:modules:${orgId}`,
    masterRecords: (orgId, apiPath) => `master:records:${orgId}:${apiPath}`,
    userDropdown: (orgId) => `users:dropdown:${orgId}`,
    campaigns: (orgId, userKey) => `campaigns:my:${orgId}:${userKey}`,
    campaignDetails: (orgId, campaignName) => `campaigns:details:${orgId}:${campaignName.toLowerCase().trim()}`,
    campaignMatrix: (orgId, queryStr) => `reports:matrix:${orgId}:${queryStr}`,
    tenantById: (id) => `tenant:id:${id}`,
    tenantBySubdomain: (subdomain) => `tenant:subdomain:${subdomain.toLowerCase().trim()}`
};
exports.CacheInvalidators = {
    invalidateTenant: (orgId, subdomain) => {
        if (orgId)
            exports.serverCache.delete(`tenant:id:${orgId}`);
        if (subdomain)
            exports.serverCache.delete(`tenant:subdomain:${subdomain.toLowerCase().trim()}`);
    },
    invalidateDashboard: (orgId) => {
        return exports.serverCache.invalidatePattern(new RegExp(`^dash:metrics:${orgId}(:|$)`));
    },
    invalidateCampaigns: (orgId, campaignName) => {
        if (campaignName) {
            exports.serverCache.invalidatePattern(new RegExp(`^campaigns:details:${orgId}:${campaignName.toLowerCase().trim()}`));
        }
        return exports.serverCache.invalidatePattern(new RegExp(`^campaigns:.*:${orgId}(:|$)`));
    },
    invalidateReports: (orgId) => {
        return exports.serverCache.invalidatePattern(new RegExp(`^reports:matrix:${orgId}(:|$)`));
    },
    invalidateMaster: (orgId, apiPath) => {
        if (apiPath) {
            return exports.serverCache.invalidatePattern(new RegExp(`^master:records:${orgId}:${apiPath}(:|$)`));
        }
        return exports.serverCache.invalidatePattern(new RegExp(`^master:.*:${orgId}(:|$)`));
    },
    invalidateStatuses: (orgId) => {
        return exports.serverCache.invalidatePattern(new RegExp(`^master:statuses:${orgId}(:|$)`));
    },
    invalidateModules: (orgId) => {
        return exports.serverCache.invalidatePattern(new RegExp(`^master:modules:${orgId}(:|$)`));
    },
    invalidateUsers: (orgId) => {
        return exports.serverCache.invalidatePattern(new RegExp(`^users:dropdown:${orgId}(:|$)`));
    },
    invalidateAllForOrg: (orgId) => {
        return exports.serverCache.invalidatePattern(new RegExp(`:${orgId}(:|$)`));
    }
};
