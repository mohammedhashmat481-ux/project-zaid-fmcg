"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const authenticate = (req, res, next) => {
    try {
        let token = '';
        // Check auth header
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
        // Check cookies if not in header
        if (!token && req.headers.cookie) {
            const cookies = Object.fromEntries(req.headers.cookie.split('; ').map((c) => {
                const parts = c.split('=');
                return [parts[0], parts.slice(1).join('=')];
            }));
            token = cookies.token;
        }
        if (!token) {
            res.status(401).json({ error: 'Authentication required. No token provided.' });
            return;
        }
        const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_access_token_key_12345';
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = decoded;
        // Also enforce that the user's tenant matches the request tenant context if specified
        if (req.organizationId && req.organizationId.toString() !== decoded.organizationId) {
            res.status(403).json({ error: 'Cross-tenant access forbidden. Access denied.' });
            return;
        }
        // Automatically bind organizationId from user if not resolved yet
        if (!req.organizationId) {
            req.organizationId = decoded.organizationId;
        }
        next();
    }
    catch (error) {
        res.status(401).json({ error: 'Invalid or expired authentication token.' });
    }
};
exports.authenticate = authenticate;
