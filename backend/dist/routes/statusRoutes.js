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
                { name: 'New', color: '#4F46E5', icon: 'Sparkles', pipelinePosition: 1, order: 1 },
                { name: 'Hot', color: '#EF4444', icon: 'Flame', pipelinePosition: 2, order: 2 },
                { name: 'Warm', color: '#F59E0B', icon: 'Sun', pipelinePosition: 3, order: 3 },
                { name: 'Cedil Pending', color: '#EC4899', icon: 'FileWarning', pipelinePosition: 4, order: 4 },
                { name: 'Document Pending', color: '#14B8A6', icon: 'FileText', pipelinePosition: 5, order: 5 },
                { name: 'Approval Pending', color: '#F97316', icon: 'Clock', pipelinePosition: 6, order: 6 },
                { name: 'Approved', color: '#10B981', icon: 'CheckCircle', pipelinePosition: 7, order: 7 },
                { name: 'Disbursed', color: '#84CC16', icon: 'Banknote', pipelinePosition: 8, order: 8, isFinal: true, isSuccess: true },
                { name: 'Rejected', color: '#F43F5E', icon: 'XOctagon', pipelinePosition: 9, order: 9, isFinal: true, isSuccess: false },
                { name: 'Followup', color: '#0EA5E9', icon: 'PhoneCall', pipelinePosition: 10, order: 10 },
                { name: 'Dropped', color: '#EF4444', icon: 'ArrowDownCircle', pipelinePosition: 11, order: 11, isFinal: true, isSuccess: false },
                { name: 'Pending', color: '#EAB308', icon: 'Hourglass', pipelinePosition: 12, order: 12 }
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
        cache_1.CacheInvalidators.invalidateStatuses(req.organizationId);
        cache_1.CacheInvalidators.invalidateDashboard(req.organizationId);
        res.status(200).json({ message: 'Status deleted successfully.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete status.' });
    }
});
exports.default = router;
