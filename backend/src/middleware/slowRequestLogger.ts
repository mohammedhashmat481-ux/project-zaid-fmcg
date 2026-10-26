import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface RequestMetric {
  path: string;
  method: string;
  duration: number;
  status: number;
  timestamp: string;
}

const SLOW_REQUEST_THRESHOLD_MS = 300;
const MAX_STORED_METRICS = 50;

let totalRequests = 0;
let totalSlowRequests = 0;
let totalDurationSum = 0;
const recentSlowRequests: RequestMetric[] = [];

export const slowRequestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  totalRequests++;

  res.on('finish', () => {
    const duration = Date.now() - start;
    totalDurationSum += duration;

    // Check if the request exceeded the 300ms threshold
    if (duration > SLOW_REQUEST_THRESHOLD_MS) {
      totalSlowRequests++;

      const metric: RequestMetric = {
        path: req.originalUrl || req.url,
        method: req.method,
        duration,
        status: res.statusCode,
        timestamp: new Date().toISOString()
      };

      recentSlowRequests.unshift(metric);
      if (recentSlowRequests.length > MAX_STORED_METRICS) {
        recentSlowRequests.pop();
      }

      const tenantId = (req as any).organizationId || (req.headers['x-tenant-id'] as string) || 'none';
      logger.warn(
        `[SLOW REQUEST >300ms] ${req.method} ${metric.path} took ${duration}ms | Status: ${res.statusCode} | Tenant: ${tenantId}`
      );
    }
  });

  next();
};

export const getRequestMetrics = () => {
  const avgDuration = totalRequests > 0 ? Math.round(totalDurationSum / totalRequests) : 0;
  return {
    totalRequests,
    totalSlowRequests,
    slowPercentage: totalRequests > 0 ? `${((totalSlowRequests / totalRequests) * 100).toFixed(1)}%` : '0%',
    averageDurationMs: avgDuration,
    recentSlowRequests: recentSlowRequests.slice(0, 10)
  };
};
