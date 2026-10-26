// inkCRM In-Memory High-Performance TTL Cache Engine
// Zero-dependency, lightweight, thread-safe for Node.js event loop

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<any>>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Run cleanup every 60 seconds
    this.cleanupInterval = setInterval(() => {
      this.purgeExpired();
    }, 60000);
    // Don't keep the process alive just for the cleanup timer
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Invalidate all keys matching a prefix or regex pattern
   */
  invalidatePattern(prefixOrPattern: string | RegExp): number {
    let deleted = 0;
    const isRegex = prefixOrPattern instanceof RegExp;

    for (const key of this.store.keys()) {
      const match = isRegex
        ? (prefixOrPattern as RegExp).test(key)
        : key.startsWith(prefixOrPattern as string);

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
  clear(): void {
    this.store.clear();
  }

  /**
   * Purge expired items
   */
  private purgeExpired(): void {
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
      uptime: process.uptime()
    };
  }
}

export const serverCache = new MemoryCache();

// Helpers for specific cache domains
export const CacheKeys = {
  dashboardMetrics: (orgId: string, userKey: string) => `dash:metrics:${orgId}:${userKey}`,
  statuses: (orgId: string) => `master:statuses:${orgId}`,
  modules: (orgId: string) => `master:modules:${orgId}`,
  masterRecords: (orgId: string, apiPath: string) => `master:records:${orgId}:${apiPath}`,
  userDropdown: (orgId: string) => `users:dropdown:${orgId}`
};

export const CacheInvalidators = {
  invalidateDashboard: (orgId: string) => {
    return serverCache.invalidatePattern(`dash:metrics:${orgId}`);
  },
  invalidateMaster: (orgId: string, apiPath?: string) => {
    if (apiPath) {
      return serverCache.invalidatePattern(`master:records:${orgId}:${apiPath}`);
    }
    return serverCache.invalidatePattern(`master:${orgId}`);
  },
  invalidateStatuses: (orgId: string) => {
    return serverCache.invalidatePattern(`master:statuses:${orgId}`);
  },
  invalidateModules: (orgId: string) => {
    return serverCache.invalidatePattern(`master:modules:${orgId}`);
  },
  invalidateUsers: (orgId: string) => {
    return serverCache.invalidatePattern(`users:dropdown:${orgId}`);
  },
  invalidateAllForOrg: (orgId: string) => {
    return serverCache.invalidatePattern(new RegExp(`:${orgId}(:|$)`));
  }
};
