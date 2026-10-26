import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { queryPg } from './config/postgres';
import { resolveTenant } from './middleware/tenantMiddleware';
import { logger } from './utils/logger';
import { getUploadDir } from './utils/uploadPaths';
import { slowRequestLogger, getRequestMetrics } from './middleware/slowRequestLogger';
import { serverCache } from './utils/cache';

// Import routers
import authRoutes from './routes/authRoutes';
import tenantRoutes from './routes/tenantRoutes';
import moduleRoutes from './routes/moduleRoutes';
import recordRoutes from './routes/recordRoutes';
import workflowRoutes from './routes/workflowRoutes';
import reportRoutes from './routes/reportRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import documentRoutes from './routes/documentRoutes';
import auditRoutes from './routes/auditRoutes';
import statusRoutes from './routes/statusRoutes';
import notificationRoutes from './routes/notificationRoutes';
import searchRoutes from './routes/searchRoutes';

const app = express();

// Enable HTTP ETag for conditional 304 caching
app.set('etag', 'strong');

// 1. High-Performance Gzip/Deflate Compression
app.use(compression({
  threshold: 1024,
  level: 6
}));

// 2. Slow Request Performance Profiler (>300ms)
app.use(slowRequestLogger);

// 2. Helmet Security Headers Setup (Configured to allow API connect-src across www and apex domains)
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: [
        "'self'",
        "https://www.novaleadnexa.in",
        "https://novaleadnexa.in",
        "http://localhost:5000",
        "http://localhost:5173",
        "ws:",
        "wss:"
      ],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  }
}));

// 3. Access Logger Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    logger.access(req.method, req.originalUrl, res.statusCode, duration, ip);
  });
  next();
});

// 4. Robust CORS Setup supporting www & apex domains, credentials, and OPTIONS preflights
const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5000',
  'https://novaleadnexa.in',
  'https://www.novaleadnexa.in',
  'http://novaleadnexa.in',
  'http://www.novaleadnexa.in'
];

const envAllowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean) 
  : [];

const allAllowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...envAllowedOrigins]));

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    if (
      origin.includes('localhost') || 
      origin.includes('127.0.0.1') ||
      origin.includes('192.168.') ||
      origin.includes('10.') ||
      origin.includes('novaleadnexa.in') ||
      allAllowedOrigins.includes(origin) ||
      allAllowedOrigins.includes('*')
    ) {
      return callback(null, true);
    }
    callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-tenant-id',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 5. Custom NoSQL Injection Protection
const sanitizeObject = (obj: any): any => {
  if (obj instanceof Object) {
    for (const key in obj) {
      if (key.startsWith('$')) {
        delete obj[key];
      } else if (obj[key] instanceof Object) {
        sanitizeObject(obj[key]);
      }
    }
  }
  return obj;
};

app.use((req, res, next) => {
  if (req.body) sanitizeObject(req.body);
  if (req.query) sanitizeObject(req.query);
  if (req.params) sanitizeObject(req.params);
  next();
});

// Serve static uploaded files (supporting all deployment folder structures)
const candidateUploadDirs = [
  getUploadDir(),
  path.resolve(process.cwd(), 'uploads'),
  path.resolve(process.cwd(), '../uploads'),
  path.resolve(__dirname, '../../uploads'),
  path.resolve(__dirname, '../../../uploads')
];

const registeredDirs = new Set<string>();
for (const dir of candidateUploadDirs) {
  if (dir && !registeredDirs.has(dir) && fs.existsSync(dir)) {
    registeredDirs.add(dir);
    app.use('/uploads', express.static(dir));
  }
}

// 6. Health, Ready, and Version check endpoints (placed before tenant resolver)
app.get('/health', async (req, res) => {
  let dbStatus = 'connected';
  try {
    await queryPg('SELECT 1');
  } catch (e: any) {
    dbStatus = `disconnected: ${e.message}`;
  }

  const mem = process.memoryUsage();
  res.status(200).json({
    status: 'UP',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: dbStatus,
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024)
    },
    cache: serverCache.stats(),
    performance: getRequestMetrics()
  });
});

app.get('/ready', async (req, res) => {
  try {
    await queryPg('SELECT 1');
    res.status(200).json({
      status: 'READY',
      database: 'connected'
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'NOT_READY',
      database: 'disconnected',
      error: err.message
    });
  }
});

app.get('/version', (req, res) => {
  res.status(200).json({
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    buildTime: new Date().toISOString()
  });
});

// Multi-tenant resolver middleware runs on all API routes
app.use(resolveTenant);

// Mount API routes (No 15-minute rate limiters)
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/tenants', tenantRoutes);
app.use('/api/v1/modules', moduleRoutes);
app.use('/api/v1/records', recordRoutes);
app.use('/api/v1/workflows', workflowRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/documents', documentRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/statuses', statusRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/search', searchRoutes);

// Serve compiled React frontend static files
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

// Fallback SPA routing for client side React router
app.get('*', (req, res, next) => {
  if (
    req.originalUrl.startsWith('/api') || 
    req.originalUrl.startsWith('/uploads') || 
    req.originalUrl.startsWith('/health') || 
    req.originalUrl.startsWith('/ready') ||
    req.originalUrl.startsWith('/version')
  ) {
    return next();
  }
  const indexPath = path.join(frontendDistPath, 'index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'Welcome to inkCRM API Server' });
  }
});

// 7. Centralized Error Handling Middleware (Hides stack traces in production)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(err.stack || err.message);
  
  const isProd = process.env.NODE_ENV === 'production';
  const statusCode = err.statusCode || err.status || 500;
  
  res.status(statusCode).json({
    success: false,
    error: isProd ? 'Internal Server Error' : err.message || 'Something went wrong on the server!'
  });
});

export default app;
