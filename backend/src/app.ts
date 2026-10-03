import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import mongoose from 'mongoose';
import { resolveTenant } from './middleware/tenantMiddleware';
import { logger } from './utils/logger';

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

// 1. Request Response Compression
app.use(compression());

// 2. Helmet Security Headers Setup
app.use(helmet({
  crossOriginResourcePolicy: false // Allows loading local static files
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

// 4. CORS Setup
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('localhost:5173')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

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

// Serve static uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// 6. Health, Ready, and Version check endpoints (placed before tenant resolver)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

app.get('/ready', async (req, res) => {
  const dbState = mongoose.connection.readyState;
  const isReady = dbState === 1; // 1 = connected
  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'READY' : 'NOT_READY',
    database: isReady ? 'connected' : 'disconnected'
  });
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
