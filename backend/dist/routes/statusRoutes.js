"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Status_1 = __importDefault(require("../models/Status"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const cache_1 = require("../utils/cache");
const leadStatusHelper_1 = require("../utils/leadStatusHelper");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authenticate);
router.use(tenantMiddleware_1.requireTenant);
// Helper function to dynamically adjust status orders sequentially
async function adjustStatusOrders(organizationId, statusIdToPlace, targetOrder, newStatusFields) {
    let statuses = await Status_1.default.find({ organizationId }).sort({ order: 1 });
    if (statusIdToPlace) {
        statuses = statuses.filter((s) => s._id.toString() !== statusIdToPlace.toString());
    }
    const insertIdx = Math.max(0, Math.min(targetOrder - 1, statuses.length));
    const resultList = [];
    for (let i = 0; i < statuses.length; i++) {
        if (i === insertIdx) {
            resultList.push({ isTarget: true });
        }
        resultList.push(statuses[i]);
    }
    if (insertIdx >= statuses.length) {
        resultList.push({ isTarget: true });
    }
    for (let index = 0; index < resultList.length; index++) {
        const item = resultList[index];
        const finalOrder = index + 1;
        if (item.isTarget) {
            newStatusFields.order = finalOrder;
        }
        else {
            if (item.order !== finalOrder) {
                item.order = finalOrder;
                await item.save();
            }
        }
    }
}
// Helper function to close gaps when a status is deleted
async function reorderAfterDelete(organizationId) {
    const statuses = await Status_1.default.find({ organizationId }).sort({ order: 1 });
    for (let index = 0; index < statuses.length; index++) {
        const item = statuses[index];
        const finalOrder = index + 1;
        if (item.order !== finalOrder) {
            item.order = finalOrder;
            await item.save();
        }
    }
}
// Helper function to sync organization dashboardStatuses with PostgreSQL statuses
async function syncOrganizationDashboardStatuses(organizationId) {
    // No-op: campaign status configuration in Organization.themeSettings is managed independently
    // by Campaign Status Settings and should never be overwritten by general status operations.
}
// 1. Get all statuses
router.get('/', async (req, res) => {
    try {
        const cacheKey = cache_1.CacheKeys.statuses(req.organizationId);
        const cached = cache_1.serverCache.get(cacheKey);
        if (cached) {
            res.setHeader('X-Cache', 'HIT');
            res.status(200).json(cached);
            return;
        }
        let statuses = await Status_1.default.find({ organizationId: req.organizationId }).sort({ order: 1 });
        // Auto-seed default standard statuses if none exist yet for this organization
        if (statuses.length === 0) {
            const defaultStatuses = [
                { name: 'HOT LEADS', color: '#EF4444', icon: 'Flame', pipelinePosition: 1, order: 1 },
                { name: 'WARM LEADS', color: '#F59E0B', icon: 'Sun', pipelinePosition: 2, order: 2 },
                { name: 'COOL LEAD', color: '#06B6D4', icon: 'Snowflake', pipelinePosition: 3, order: 3 },
                { name: 'CEBIL PENDING', color: '#EC4899', icon: 'FileWarning', pipelinePosition: 4, order: 4 },
                { name: 'DOCUMENT PENDING', color: '#14B8A6', icon: 'FileText', pipelinePosition: 5, order: 5 },
                { name: 'APPROVAL PENDING', color: '#F97316', icon: 'Clock', pipelinePosition: 6, order: 6 },
                { name: 'APPROVED BUT NOT DISBUSE', color: '#10B981', icon: 'CheckCircle', pipelinePosition: 7, order: 7 },
                { name: 'DISBUSED', color: '#84CC16', icon: 'Banknote', pipelinePosition: 8, order: 8, isFinal: true, isSuccess: true },
                { name: 'REJECTED', color: '#F43F5E', icon: 'XOctagon', pipelinePosition: 9, order: 9, isFinal: true, isSuccess: false },
                { name: 'FOLLOWUP', color: '#0EA5E9', icon: 'PhoneCall', pipelinePosition: 10, order: 10 },
                { name: 'DROPPED', color: '#EF4444', icon: 'ArrowDownCircle', pipelinePosition: 11, order: 11, isFinal: true, isSuccess: false },
                { name: 'PENDING', color: '#EAB308', icon: 'Hourglass', pipelinePosition: 12, order: 12 },
                { name: 'GIVEN LOGIN', color: '#8B5CF6', icon: 'KeyRound', pipelinePosition: 13, order: 13 }
            ];
            const toInsert = defaultStatuses.map(s => ({
                organizationId: req.organizationId,
                ...s,
                dashboardVisibility: true,
                isFinal: s.isFinal || false,
                isSuccess: s.isSuccess || false
            }));
            try {
                await Status_1.default.insertMany(toInsert, { ordered: false });
            }
            catch (insertErr) {
                // ignore duplicate key errors if already concurrently inserted
            }
            statuses = await Status_1.default.find({ organizationId: req.organizationId }).sort({ order: 1 });
        }
        // Auto-ensure ALL standard pipeline stages exist and have dashboardVisibility: true
        const standardPipelineList = [
            { name: 'HOT LEADS', color: '#EF4444', icon: 'Flame', pipelinePosition: 1, order: 1 },
            { name: 'WARM LEADS', color: '#F59E0B', icon: 'Sun', pipelinePosition: 2, order: 2 },
            { name: 'COOL LEAD', color: '#06B6D4', icon: 'Snowflake', pipelinePosition: 3, order: 3 },
            { name: 'CEBIL PENDING', color: '#EC4899', icon: 'FileWarning', pipelinePosition: 4, order: 4 },
            { name: 'DOCUMENT PENDING', color: '#14B8A6', icon: 'FileText', pipelinePosition: 5, order: 5 },
            { name: 'APPROVAL PENDING', color: '#F97316', icon: 'Clock', pipelinePosition: 6, order: 6 },
            { name: 'APPROVED BUT NOT DISBUSE', color: '#10B981', icon: 'CheckCircle', pipelinePosition: 7, order: 7 },
            { name: 'DISBUSED', color: '#84CC16', icon: 'Banknote', pipelinePosition: 8, order: 8, isFinal: true, isSuccess: true },
            { name: 'REJECTED', color: '#F43F5E', icon: 'XOctagon', pipelinePosition: 9, order: 9, isFinal: true, isSuccess: false },
            { name: 'FOLLOWUP', color: '#0EA5E9', icon: 'PhoneCall', pipelinePosition: 10, order: 10 },
            { name: 'DROPPED', color: '#EF4444', icon: 'ArrowDownCircle', pipelinePosition: 11, order: 11, isFinal: true, isSuccess: false },
            { name: 'PENDING', color: '#EAB308', icon: 'Hourglass', pipelinePosition: 12, order: 12 },
            { name: 'GIVEN LOGIN', color: '#8B5CF6', icon: 'KeyRound', pipelinePosition: 13, order: 13 }
        ];
        const missingStandard = [];
        let maxOrder = statuses.length > 0 ? Math.max(...statuses.map((s) => s.order || 0)) : 0;
        for (const std of standardPipelineList) {
            const upper = std.name.toUpperCase();
            const stripped = upper.replace(/\s+LEADS?$/i, '').trim();
            let found = statuses.find((s) => {
                const u = (s.name || '').toUpperCase().trim();
                const sStripped = u.replace(/\s+LEADS?$/i, '').trim();
                return u === upper || sStripped === stripped;
            });
            if (!found) {
                maxOrder++;
                missingStandard.push({
                    organizationId: req.organizationId,
                    name: std.name,
                    color: std.color,
                    icon: std.icon,
                    pipelinePosition: std.pipelinePosition,
                    order: std.order || maxOrder,
                    dashboardVisibility: true,
                    isFinal: std.isFinal || false,
                    isSuccess: std.isSuccess || false
                });
            }
            else if (found.dashboardVisibility === false) {
                found.dashboardVisibility = true;
                await found.save();
            }
        }
        // Automatically purge any raw dialing dispositions that may have been saved to statuses
        const invalidStatuses = statuses.filter((s) => {
            const u = (s.name || '').toUpperCase().trim();
            const stripped = u.replace(/\s+LEADS?$/i, '').trim();
            return leadStatusHelper_1.RAW_CAMPAIGN_DISPOSITIONS.has(u) || leadStatusHelper_1.RAW_CAMPAIGN_DISPOSITIONS.has(stripped) || u === 'NEWS' || u === 'NEW';
        });
        if (invalidStatuses.length > 0) {
            const invalidIds = invalidStatuses.map((s) => s._id);
            await Status_1.default.deleteMany({ _id: { $in: invalidIds } });
            statuses = statuses.filter((s) => !invalidIds.includes(s._id));
        }
        // Deduplicate any duplicate status entries (e.g. "Warm Lead" and "WARM LEADS")
        const seenCanonical = new Set();
        const duplicateIds = [];
        for (const s of statuses) {
            const u = (s.name || '').toUpperCase().trim();
            const stripped = u.replace(/\s+LEADS?$/i, '').trim();
            const canonicalKey = stripped || u;
            if (seenCanonical.has(canonicalKey)) {
                duplicateIds.push(s._id);
            }
            else {
                seenCanonical.add(canonicalKey);
            }
        }
        if (duplicateIds.length > 0) {
            await Status_1.default.deleteMany({ _id: { $in: duplicateIds } });
            statuses = statuses.filter((s) => !duplicateIds.includes(s._id));
        }
        if (missingStandard.length > 0) {
            try {
                await Status_1.default.insertMany(missingStandard, { ordered: false });
                statuses = await Status_1.default.find({ organizationId: req.organizationId }).sort({ order: 1 });
            }
            catch (_) { }
        }
        cache_1.serverCache.set(cacheKey, statuses, 600); // 10 minutes cache
        res.setHeader('X-Cache', 'MISS');
        res.status(200).json(statuses);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to retrieve statuses.' });
    }
});
// 2. Create new status
router.post('/', async (req, res) => {
    try {
        const { name, color, icon, pipelinePosition, dashboardVisibility, isFinal, isSuccess, order } = req.body;
        if (!name) {
            res.status(400).json({ error: 'Name is required.' });
            return;
        }
        // Auto-calculate order if not provided
        let calculatedOrder = order;
        if (order === undefined || order === 0) {
            const count = await Status_1.default.countDocuments({ organizationId: req.organizationId });
            calculatedOrder = count + 1;
        }
        calculatedOrder = Math.max(1, calculatedOrder);
        const newStatusFields = {
            organizationId: req.organizationId,
            name,
            color: color || '#4F46E5',
            icon: icon || 'Circle',
            pipelinePosition: pipelinePosition || 0,
            dashboardVisibility: dashboardVisibility !== undefined ? dashboardVisibility : true,
            isFinal: isFinal !== undefined ? isFinal : false,
            isSuccess: isSuccess !== undefined ? isSuccess : false,
            order: calculatedOrder
        };
        // Shift other statuses to accommodate the new status
        await adjustStatusOrders(req.organizationId, null, calculatedOrder, newStatusFields);
        const status = await Status_1.default.create(newStatusFields);
        await syncOrganizationDashboardStatuses(req.organizationId);
        cache_1.CacheInvalidators.invalidateStatuses(req.organizationId);
        cache_1.CacheInvalidators.invalidateDashboard(req.organizationId);
        res.status(201).json(status);
    }
    catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ error: 'Status name must be unique.' });
        }
        else {
            res.status(500).json({ error: 'Failed to create status.' });
        }
    }
});
// 3. Update status
router.put('/:id', async (req, res) => {
    try {
        const { name, color, icon, pipelinePosition, dashboardVisibility, isFinal, isSuccess, order } = req.body;
        const status = await Status_1.default.findOne({ _id: req.params.id, organizationId: req.organizationId });
        if (!status) {
            res.status(404).json({ error: 'Status not found.' });
            return;
        }
        if (name)
            status.name = name;
        if (color)
            status.color = color;
        if (icon)
            status.icon = icon;
        if (pipelinePosition !== undefined)
            status.pipelinePosition = pipelinePosition;
        if (dashboardVisibility !== undefined)
            status.dashboardVisibility = dashboardVisibility;
        if (isFinal !== undefined)
            status.isFinal = isFinal;
        if (isSuccess !== undefined)
            status.isSuccess = isSuccess;
        if (order !== undefined) {
            const targetOrder = Math.max(1, order);
            const tempWrapper = { order: targetOrder };
            await adjustStatusOrders(req.organizationId, status._id.toString(), targetOrder, tempWrapper);
            status.order = tempWrapper.order;
        }
        await status.save();
        await syncOrganizationDashboardStatuses(req.organizationId);
        cache_1.CacheInvalidators.invalidateStatuses(req.organizationId);
        cache_1.CacheInvalidators.invalidateDashboard(req.organizationId);
        res.status(200).json(status);
    }
    catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ error: 'Status name must be unique.' });
        }
        else {
            res.status(500).json({ error: 'Failed to update status.' });
        }
    }
});
// 4. Delete status
router.delete('/:id', async (req, res) => {
    try {
        const status = await Status_1.default.findOneAndDelete({ _id: req.params.id, organizationId: req.organizationId });
        if (!status) {
            res.status(404).json({ error: 'Status not found.' });
            return;
        }
        await reorderAfterDelete(req.organizationId);
        await syncOrganizationDashboardStatuses(req.organizationId);
        cache_1.CacheInvalidators.invalidateStatuses(req.organizationId);
        cache_1.CacheInvalidators.invalidateDashboard(req.organizationId);
        res.status(200).json({ message: 'Status deleted successfully.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete status.' });
    }
});
exports.default = router;
