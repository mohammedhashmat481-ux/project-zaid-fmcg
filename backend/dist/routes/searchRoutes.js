"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const PgModel_1 = require("../models/PgModel");
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authenticate);
router.use(tenantMiddleware_1.requireTenant);
// Global Search endpoint
router.get('/', async (req, res) => {
    try {
        const orgId = req.organizationId;
        const rawQ = String(req.query.q || '').trim();
        if (!rawQ || rawQ.length < 1) {
            res.status(200).json([]);
            return;
        }
        // Strip prefix like "LND-" or "#" or "lnd-"
        const cleanQ = rawQ.replace(/^(lnd-|#)/i, '').trim();
        // Fetch all active modules for this organization
        const modules = await ModuleDefinition_1.default.find({ organizationId: orgId }).lean();
        const regex = new RegExp(cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const isNumericOnly = /^\d+$/.test(cleanQ);
        const isEmailLike = cleanQ.includes('@');
        // Run module searches in parallel for instant multi-module search response
        const searchPromises = modules.map(async (moduleDef) => {
            let matchConditions = [];
            if (isEmailLike) {
                matchConditions = [
                    { 'data.email': regex },
                    { 'data.mail': regex }
                ];
            }
            else if (isNumericOnly) {
                matchConditions = [
                    { 'data.phone': regex },
                    { 'data.mobile': regex },
                    { 'data.contactNumber': regex },
                    { 'data.contact_num': regex },
                    { 'data.leadNo': regex },
                    { 'data.allocatedNo': regex },
                    { 'data.dataCode': regex }
                ];
            }
            else {
                matchConditions = [
                    { 'data.firstName': regex },
                    { 'data.lastName': regex },
                    { 'data.customerName': regex },
                    { 'data.leadName': regex },
                    { 'data.name': regex },
                    { 'data.phone': regex },
                    { 'data.mobile': regex },
                    { 'data.dataCode': regex },
                    { 'data.leadNo': regex },
                    { 'data.company': regex },
                    { 'data.firmName': regex },
                    { 'data.email': regex },
                    { 'data.city': regex },
                    { 'data.status': regex },
                    { 'data.loanType': regex }
                ];
            }
            // If cleanQ is valid ID, match exact _id
            if (PgModel_1.PgObjectId.isValid(cleanQ)) {
                matchConditions.push({ _id: cleanQ });
            }
            // Match partial string or hex suffix of ID
            if (cleanQ.length >= 3 && /^[0-9a-fA-F-]+$/.test(cleanQ)) {
                matchConditions.push({ id: regex });
            }
            const records = await CustomRecord_1.default.find({
                organizationId: orgId,
                moduleId: moduleDef._id || moduleDef.id,
                $or: matchConditions
            })
                .sort({ updatedAt: -1 })
                .limit(10)
                .lean();
            if (records && records.length > 0) {
                return {
                    module: {
                        _id: moduleDef._id || moduleDef.id,
                        apiPath: moduleDef.apiPath,
                        pluralLabel: moduleDef.pluralLabel,
                        singularLabel: moduleDef.singularLabel,
                        icon: moduleDef.icon || 'Layers'
                    },
                    records
                };
            }
            return null;
        });
        const settledResults = await Promise.all(searchPromises);
        const searchResults = settledResults.filter(Boolean);
        res.status(200).json(searchResults);
    }
    catch (error) {
        console.error('Global Search Error:', error);
        res.status(500).json({ error: 'Failed to perform search.' });
    }
});
exports.default = router;
