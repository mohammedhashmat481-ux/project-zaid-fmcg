"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const postgres_1 = require("./config/postgres");
const tenantMiddleware_1 = require("./middleware/tenantMiddleware");
const logger_1 = require("./utils/logger");
const uploadPaths_1 = require("./utils/uploadPaths");
const slowRequestLogger_1 = require("./middleware/slowRequestLogger");
const cache_1 = require("./utils/cache");
// Import routers
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const tenantRoutes_1 = __importDefault(require("./routes/tenantRoutes"));
const moduleRoutes_1 = __importDefault(require("./routes/moduleRoutes"));
const recordRoutes_1 = __importDefault(require("./routes/recordRoutes"));
const workflowRoutes_1 = __importDefault(require("./routes/workflowRoutes"));
const reportRoutes_1 = __importDefault(require("./routes/reportRoutes"));
const dashboardRoutes_1 = __importDefault(require("./routes/dashboardRoutes"));
const documentRoutes_1 = __importDefault(require("./routes/documentRoutes"));
const auditRoutes_1 = __importDefault(require("./routes/auditRoutes"));
const statusRoutes_1 = __importDefault(require("./routes/statusRoutes"));
const notificationRoutes_1 = __importDefault(require("./routes/notificationRoutes"));
const searchRoutes_1 = __importDefault(require("./routes/searchRoutes"));
const app = (0, express_1.default)();
// Enable HTTP ETag for conditional 304 caching
app.set('etag', 'strong');
// 1. High-Performance Gzip/Deflate Compression
app.use((0, compression_1.default)({
    threshold: 1024,
    level: 6
}));
// 2. Slow Request Performance Profiler (>300ms)
app.use(slowRequestLogger_1.slowRequestLogger);
// 2. Helmet Security Headers Setup (Configured to allow API connect-src across www and apex domains)
app.use((0, helmet_1.default)({
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
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        logger_1.logger.access(req.method, req.originalUrl, res.statusCode, duration, ip);
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
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) {
            return callback(null, true);
        }
        if (origin.includes('localhost') ||
            origin.includes('127.0.0.1') ||
            origin.includes('192.168.') ||
            origin.includes('10.') ||
            origin.includes('novaleadnexa.in') ||
            allAllowedOrigins.includes(origin) ||
            allAllowedOrigins.includes('*')) {
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
app.use((0, cors_1.default)(corsOptions));
app.options('*', (0, cors_1.default)(corsOptions));
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ limit: '50mb', extended: true }));
// 5. Custom NoSQL Injection Protection
const sanitizeObject = (obj) => {
    if (obj instanceof Object) {
        for (const key in obj) {
            if (key.startsWith('$')) {
                delete obj[key];
            }
            else if (obj[key] instanceof Object) {
                sanitizeObject(obj[key]);
            }
        }
    }
    return obj;
};
app.use((req, res, next) => {
    if (req.body)
        sanitizeObject(req.body);
    if (req.query)
        sanitizeObject(req.query);
    if (req.params)
        sanitizeObject(req.params);
    next();
});
// Serve static uploaded files (supporting all deployment folder structures)
const candidateUploadDirs = [
    (0, uploadPaths_1.getUploadDir)(),
    path_1.default.resolve(process.cwd(), 'uploads'),
    path_1.default.resolve(process.cwd(), '../uploads'),
    path_1.default.resolve(__dirname, '../../uploads'),
    path_1.default.resolve(__dirname, '../../../uploads')
];
const registeredDirs = new Set();
for (const dir of candidateUploadDirs) {
    if (dir && !registeredDirs.has(dir) && fs_1.default.existsSync(dir)) {
        registeredDirs.add(dir);
        app.use('/uploads', express_1.default.static(dir));
    }
}
// 6. Health, Ready, and Version check endpoints (placed before tenant resolver)
app.get('/health', async (req, res) => {
    let dbStatus = 'connected';
    try {
        await (0, postgres_1.queryPg)('SELECT 1');
    }
    catch (e) {
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
        cache: cache_1.serverCache.stats(),
        performance: (0, slowRequestLogger_1.getRequestMetrics)()
    });
});
app.get('/ready', async (req, res) => {
    try {
        await (0, postgres_1.queryPg)('SELECT 1');
        res.status(200).json({
            status: 'READY',
            database: 'connected'
        });
    }
    catch (err) {
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
app.use(tenantMiddleware_1.resolveTenant);
// Mount API routes (No 15-minute rate limiters)
app.use('/api/v1/auth', authRoutes_1.default);
app.use('/api/v1/tenants', tenantRoutes_1.default);
app.use('/api/v1/modules', moduleRoutes_1.default);
app.use('/api/v1/records', recordRoutes_1.default);
app.use('/api/v1/workflows', workflowRoutes_1.default);
app.use('/api/v1/reports', reportRoutes_1.default);
app.use('/api/v1/dashboard', dashboardRoutes_1.default);
app.use('/api/v1/documents', documentRoutes_1.default);
app.use('/api/v1/audit', auditRoutes_1.default);
app.use('/api/v1/statuses', statusRoutes_1.default);
app.use('/api/v1/notifications', notificationRoutes_1.default);
app.use('/api/v1/search', searchRoutes_1.default);
// Serve compiled React frontend static files
const frontendDistPath = path_1.default.join(__dirname, '../../frontend/dist');
app.use(express_1.default.static(frontendDistPath));
// Fallback SPA routing for client side React router
app.get('*', (req, res, next) => {
    if (req.originalUrl.startsWith('/api') ||
        req.originalUrl.startsWith('/uploads') ||
        req.originalUrl.startsWith('/health') ||
        req.originalUrl.startsWith('/ready') ||
        req.originalUrl.startsWith('/version')) {
        return next();
    }
    const indexPath = path_1.default.join(frontendDistPath, 'index.html');
    const fs = require('fs');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    }
    else {
        res.json({ message: 'Welcome to inkCRM API Server' });
    }
});
// 7. Centralized Error Handling Middleware (Hides stack traces in production)
app.use((err, req, res, next) => {
    logger_1.logger.error(err.stack || err.message);
    const isProd = process.env.NODE_ENV === 'production';
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
        success: false,
        error: isProd ? 'Internal Server Error' : err.message || 'Something went wrong on the server!'
    });
});
exports.default = app;
