"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Notification_1 = __importDefault(require("../models/Notification"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const router = (0, express_1.Router)();
// Protect all notification routes with auth and tenant resolution
router.use(authMiddleware_1.authenticate);
router.use(tenantMiddleware_1.requireTenant);
// 1. GET user notifications
router.get('/', async (req, res) => {
    try {
        const userId = req.user?.id;
        const orgId = req.organizationId || req.user?.organizationId;
        const limit = Math.min(Number(req.query.limit) || 20, 50);
        if (!userId || !orgId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const notifications = await Notification_1.default.find({
            organizationId: orgId,
            userId: userId
        })
            .sort({ createdAt: -1 })
            .limit(limit);
        res.status(200).json(notifications);
    }
    catch (error) {
        console.error('Fetch Notifications Error:', error);
        res.status(500).json({ error: 'Failed to fetch notifications.' });
    }
});
// 2. GET unread count
router.get('/unread-count', async (req, res) => {
    try {
        const userId = req.user?.id;
        const orgId = req.organizationId || req.user?.organizationId;
        if (!userId || !orgId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const unreadCount = await Notification_1.default.countDocuments({
            organizationId: orgId,
            userId: userId,
            isRead: false
        });
        res.status(200).json({ unreadCount });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch unread count.' });
    }
});
// 3. POST send test notification
router.post('/test', async (req, res) => {
    try {
        const userId = req.user?.id;
        const orgId = req.organizationId || req.user?.organizationId;
        const { title, message, type, link } = req.body;
        if (!userId || !orgId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const notification = await Notification_1.default.create({
            organizationId: orgId,
            userId: userId,
            title: title || 'New Lead Assignment & Alert',
            message: message || 'Welcome to Ink CRM Notification Center! Real-time alerts, campaign distributions, and status updates are operational.',
            type: type || 'info',
            isRead: false,
            link: link || '/modules/leads'
        });
        res.status(201).json(notification);
    }
    catch (error) {
        console.error('Create Test Notification Error:', error);
        res.status(500).json({ error: 'Failed to send test notification.' });
    }
});
// 4. Mark single notification as read
router.put('/:id/read', async (req, res) => {
    try {
        const userId = req.user?.id;
        const orgId = req.organizationId || req.user?.organizationId;
        const { id } = req.params;
        const notification = await Notification_1.default.findOneAndUpdate({
            _id: id,
            organizationId: orgId,
            userId: userId
        }, { isRead: true }, { new: true });
        if (!notification) {
            res.status(404).json({ error: 'Notification not found.' });
            return;
        }
        res.status(200).json(notification);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update notification.' });
    }
});
// 5. Mark all as read
router.put('/read-all', async (req, res) => {
    try {
        const userId = req.user?.id;
        const orgId = req.organizationId || req.user?.organizationId;
        await Notification_1.default.updateMany({
            organizationId: orgId,
            userId: userId,
            isRead: false
        }, { isRead: true });
        res.status(200).json({ message: 'All notifications marked as read.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to mark all notifications as read.' });
    }
});
// 6. Clear all notifications
router.delete('/clear-all', async (req, res) => {
    try {
        const userId = req.user?.id;
        const orgId = req.organizationId || req.user?.organizationId;
        await Notification_1.default.deleteMany({
            organizationId: orgId,
            userId: userId
        });
        res.status(200).json({ message: 'Notifications cleared.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to clear notifications.' });
    }
});
exports.default = router;
