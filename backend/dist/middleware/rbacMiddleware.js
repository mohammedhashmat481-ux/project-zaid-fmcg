"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkPermission = void 0;
const Role_1 = __importDefault(require("../models/Role"));
const matchModuleName = (permName, targetName) => {
    const p = permName.toLowerCase();
    const t = targetName.toLowerCase();
    if (p === t)
        return true;
    if (p === t + 's' || t === p + 's')
        return true;
    if (p === t.replace(/y$/, 'ies') || t === p.replace(/y$/, 'ies'))
        return true;
    return false;
};
const checkPermission = (moduleName, action) => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Unauthorized. Authenticated user required.' });
                return;
            }
            const role = await Role_1.default.findById(req.user.roleId);
            if (!role) {
                res.status(403).json({ error: 'Access Denied. User role not found.' });
                return;
            }
            // Bypass checks for Main Admin and Super Admin
            if ((role.name === 'Main Admin' || role.name === 'Super Admin') && (role.isSystem || role.name === 'Main Admin')) {
                req.permissionScope = 'all';
                return next();
            }
            // Find module permission configuration using singular/plural helper
            const modulePerm = role.permissions.modules.find((p) => matchModuleName(p.moduleName, moduleName));
            if (!modulePerm) {
                res.status(403).json({ error: `Access Denied. No permission configured for module: ${moduleName}` });
                return;
            }
            if (action === 'create') {
                if (modulePerm.create) {
                    return next();
                }
                else {
                    res.status(403).json({ error: `Access Denied. You do not have create permissions for ${moduleName}` });
                    return;
                }
            }
            // Read, Update, Delete check ('all' | 'own' | 'none')
            const actionScope = modulePerm[action]; // will be 'all', 'own', or 'none'
            if (actionScope === 'none') {
                res.status(403).json({ error: `Access Denied. You do not have ${action} permissions for ${moduleName}` });
                return;
            }
            // Attach permission scope to request for controller queries filtering
            req.permissionScope = actionScope;
            next();
        }
        catch (error) {
            console.error('RBAC Middleware Error:', error);
            res.status(500).json({ error: 'Internal server error validating permissions.' });
        }
    };
};
exports.checkPermission = checkPermission;
