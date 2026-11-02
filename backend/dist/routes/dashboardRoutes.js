"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const DashboardLayout_1 = __importDefault(require("../models/DashboardLayout"));
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
const Activity_1 = __importDefault(require("../models/Activity"));
const Status_1 = __importDefault(require("../models/Status"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const hierarchy_1 = require("../utils/hierarchy");
const cache_1 = require("../utils/cache");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authenticate);
router.use(tenantMiddleware_1.requireTenant);
// 1. Get Dashboard Layout for User
router.get('/layout', async (req, res) => {
    try {
        // Attempt to locate a user-specific dashboard layout
        let layout = await DashboardLayout_1.default.findOne({
            organizationId: req.organizationId,
            userId: req.user?.id
        });
        // Fallback: locate the organization's default dashboard layout
        if (!layout) {
            layout = await DashboardLayout_1.default.findOne({
                organizationId: req.organizationId,
                isDefault: true
            });
        }
        res.status(200).json(layout || { widgets: [] });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to retrieve dashboard configuration.' });
    }
});
// 2. Save/Update Dashboard Layout
router.put('/layout', async (req, res) => {
    try {
        const { widgets } = req.body;
        let layout = await DashboardLayout_1.default.findOne({
            organizationId: req.organizationId,
            userId: req.user?.id
        });
        if (layout) {
            layout.widgets = widgets;
            await layout.save();
        }
        else {
            layout = await DashboardLayout_1.default.create({
                organizationId: req.organizationId,
                userId: req.user?.id,
                name: 'My Dashboard',
                widgets
            });
        }
        cache_1.CacheInvalidators.invalidateDashboard(req.organizationId);
        res.status(200).json(layout);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update dashboard widgets.' });
    }
});
// 3. Fetch Real-time Metadata KPI Counts
router.get('/metrics', async (req, res) => {
    try {
        const orgId = req.organizationId;
        const userScopeKey = req.user?.id ? `${req.user.id}:${req.user.roleId || 'role'}` : 'anon';
        const cacheKey = cache_1.CacheKeys.dashboardMetrics(orgId, userScopeKey);
        const cachedData = cache_1.serverCache.get(cacheKey);
        if (cachedData) {
            res.setHeader('X-Cache', 'HIT');
            res.status(200).json(cachedData);
            return;
        }
        // Find Lead and Deal Module Definitions
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'leads' });
        const dealModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'deals' });
        const leadQuery = {
            organizationId: orgId
        };
        if (leadModule) {
            leadQuery.moduleId = leadModule._id;
        }
        const dealQuery = {
            organizationId: orgId
        };
        if (dealModule) {
            dealQuery.moduleId = dealModule._id;
        }
        // Apply Dynamic Reporting Manager Hierarchy filtering
        await hierarchy_1.HierarchyService.modifyRecordQuery(leadQuery, req.user, orgId);
        await hierarchy_1.HierarchyService.modifyRecordQuery(dealQuery, req.user, orgId);
        const statusCounts = {};
        const pipelineData = {
            'Prospecting': 0,
            'Qualification': 0,
            'Proposal': 0,
            'Negotiation': 0,
            'Closed Won': 0,
            'Closed Lost': 0
        };
        let dealStatus = { open: 0, won: 0, lost: 0, pending: 0 };
        let todayFollowupsCount = 0;
        let todayFollowupsList = [];
        const now = new Date();
        const localTodayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const utcTodayStr = now.toISOString().split('T')[0];
        if (leadModule) {
            // Direct indexed follow-up date lookups
            const followUpQuery = {
                organizationId: orgId,
                moduleId: leadModule._id,
                'data.followUpDate': { $in: [localTodayStr, utcTodayStr] }
            };
            await hierarchy_1.HierarchyService.modifyRecordQuery(followUpQuery, req.user, orgId);
            const upcomingQuery = {
                organizationId: orgId,
                moduleId: leadModule._id,
                'data.followUpDate': { $gt: localTodayStr > utcTodayStr ? localTodayStr : utcTodayStr }
            };
            await hierarchy_1.HierarchyService.modifyRecordQuery(upcomingQuery, req.user, orgId);
            const activityQuery = { organizationId: orgId };
            const isSuper = await hierarchy_1.HierarchyService.isSuperAdmin(req.user?.roleId);
            if (!isSuper) {
                const descendants = await hierarchy_1.HierarchyService.getSubordinateUserIds(req.user?.id, orgId);
                const allowedUserIds = [String(req.user?.id), ...descendants];
                activityQuery.userId = { $in: allowedUserIds };
            }
            // Execute all independent queries in parallel using indexed columns (<30ms)
            const [leadAgg, todayFollowupsCountRes, todayFollowupsListRes, upcomingFollowupsListRes, dealAggRes, recentActivitiesRes] = await Promise.all([
                CustomRecord_1.default.aggregate([
                    { $match: leadQuery },
                    { $group: { _id: '$data.status', count: { $sum: 1 } } }
                ]),
                CustomRecord_1.default.countDocuments(followUpQuery),
                CustomRecord_1.default.find(followUpQuery)
                    .select('_id data.firstName data.lastName data.company data.phone data.budget data.followUpDate data.status data.caseDetails createdBy')
                    .populate('createdBy', 'firstName lastName name email')
                    .sort({ 'data.followUpDate': 1 })
                    .limit(10),
                CustomRecord_1.default.find(upcomingQuery)
                    .select('_id data.firstName data.lastName data.company data.phone data.budget data.followUpDate data.status data.caseDetails createdBy')
                    .populate('createdBy', 'firstName lastName name email')
                    .sort({ 'data.followUpDate': 1 })
                    .limit(10),
                dealModule
                    ? CustomRecord_1.default.aggregate([
                        { $match: dealQuery },
                        { $group: { _id: '$data.stage', total: { $sum: { $toDouble: '$data.amount' } } } }
                    ])
                    : Promise.resolve([]),
                Activity_1.default.find(activityQuery)
                    .populate('userId', 'firstName lastName')
                    .sort({ createdAt: -1 })
                    .limit(10)
            ]);
            // Retrieve all configured status names for this organization to guarantee dynamic statuses count
            const configuredStatusRecords = await Status_1.default.find({ organizationId: orgId }).select('name').lean();
            const configuredStatusNames = new Set(configuredStatusRecords.map((s) => (s.name || '').trim().toUpperCase()).filter(Boolean));
            const pipelineRegex = /^(HOT(\s+LEADS?)?|WARM(\s+LEADS?)?|COOL(\s+LEADS?)?|CE[BD]IL(\s+PENDING)?|DOC(UMENT)?S?(\s+PENDING)?|PROPOSAL|APPROVALS?(\s+PENDING)?|NEGOTIATION|APPROVED(\s+BUT\s+NOT\s+DISBU(RS|S)E?D?)?|DISBU(RS|S)E?D?|REJECT(ED)?|FOLLOW[- ]?UP|DROP(PED)?|PENDING|CALL(\s+REJECTED)?|NOT(\s+CONNECTED|\s+REACHABLE|\s+INTESTED|\s+INTERESTED|\s+EXISTS)?|NO(\s+ANSWER|\s+BUSINESS)?|WRONG(\s+NUMBER)?|REPEATED(\s+NUMBER)?|INK\s*WORLDWIDE)$/i;
            let totalPipelineLeads = 0;
            leadAgg.forEach((item) => {
                if (item._id) {
                    const rawName = item._id.toString().trim();
                    const upper = rawName.toUpperCase();
                    const count = Number(item.count || 0);
                    statusCounts[upper] = (statusCounts[upper] || 0) + count;
                    if (rawName !== upper) {
                        statusCounts[rawName] = (statusCounts[rawName] || 0) + count;
                    }
                    // Singular / Plural variation support (e.g. "COOL LEAD" <-> "COOL LEADS")
                    const noS = upper.endsWith('S') ? upper.slice(0, -1) : upper;
                    const withS = upper.endsWith('S') ? upper : `${upper}S`;
                    statusCounts[noS] = (statusCounts[noS] || 0) + count;
                    statusCounts[withS] = (statusCounts[withS] || 0) + count;
                    // Strip "LEAD" / "LEADS" suffix variation support (e.g. "COOL" <-> "COOL LEAD")
                    const stripped = upper.replace(/\s+LEADS?$/i, '').trim();
                    if (stripped) {
                        statusCounts[stripped] = (statusCounts[stripped] || 0) + count;
                        statusCounts[`${stripped} LEAD`] = (statusCounts[`${stripped} LEAD`] || 0) + count;
                        statusCounts[`${stripped} LEADS`] = (statusCounts[`${stripped} LEADS`] || 0) + count;
                    }
                    if (pipelineRegex.test(upper) ||
                        configuredStatusNames.has(upper) ||
                        configuredStatusNames.has(rawName) ||
                        configuredStatusNames.has(stripped) ||
                        configuredStatusNames.has(noS) ||
                        configuredStatusNames.has(withS)) {
                        totalPipelineLeads += count;
                    }
                }
            });
            todayFollowupsCount = todayFollowupsCountRes;
            todayFollowupsList = todayFollowupsListRes;
            const upcomingFollowupsList = upcomingFollowupsListRes;
            const upcomingFollowupsCount = upcomingFollowupsList.length;
            let isUpcoming = false;
            if (todayFollowupsCount === 0 && upcomingFollowupsCount > 0) {
                isUpcoming = true;
            }
            if (dealModule && Array.isArray(dealAggRes)) {
                dealAggRes.forEach((item) => {
                    if (item._id && pipelineData[item._id] !== undefined) {
                        pipelineData[item._id] = item.total;
                    }
                });
            }
            const resultData = {
                statusCounts,
                pipelineData,
                dealStatus,
                todayFollowupsCount,
                todayFollowupsList,
                upcomingFollowupsList,
                upcomingFollowupsCount,
                isUpcoming,
                totalLeads: totalPipelineLeads,
                recentActivities: recentActivitiesRes
            };
            cache_1.serverCache.set(cacheKey, resultData, 5); // 5 seconds cache TTL for instantaneous UI sync
            res.setHeader('X-Cache', 'MISS');
            res.status(200).json(resultData);
            return;
        }
        const fallbackData = {
            statusCounts,
            pipelineData,
            dealStatus,
            todayFollowupsCount: 0,
            todayFollowupsList: [],
            upcomingFollowupsList: [],
            upcomingFollowupsCount: 0,
            isUpcoming: false,
            totalLeads: 0,
            recentActivities: []
        };
        cache_1.serverCache.set(cacheKey, fallbackData, 45);
        res.setHeader('X-Cache', 'MISS');
        res.status(200).json(fallbackData);
    }
    catch (error) {
        console.error('Metrics Error:', error);
        res.status(500).json({ error: 'Failed to retrieve dashboard KPI metrics.' });
    }
});
exports.default = router;
