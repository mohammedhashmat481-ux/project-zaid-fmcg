"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const AuditLog_1 = __importDefault(require("../models/AuditLog"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const hierarchy_1 = require("../utils/hierarchy");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authenticate);
router.use(tenantMiddleware_1.requireTenant);
// List audit logs for tenant
router.get('/', async (req, res) => {
    try {
        const query = { organizationId: req.organizationId };
        await hierarchy_1.HierarchyService.modifyAuditLogQuery(query, req.user, req.organizationId);
        const logs = await AuditLog_1.default.find(query)
            .populate('userId', 'firstName lastName email')
            .sort({ createdAt: -1 })
            .limit(100);
        res.status(200).json(logs);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to retrieve system audit logs.' });
    }
});
exports.default = router;
