"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ReportDefinition_1 = __importDefault(require("../models/ReportDefinition"));
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
const reportBuilder_1 = require("../services/reportBuilder");
const authMiddleware_1 = require("../middleware/authMiddleware");
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
const User_1 = __importDefault(require("../models/User"));
const cache_1 = require("../utils/cache");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authenticate);
router.use(tenantMiddleware_1.requireTenant);
// Campaign Daily, Monthly, Annually Matrix Report API Endpoint (Real Database Aggregation)
router.get('/campaign-matrix', async (req, res) => {
    try {
        const orgId = req.organizationId;
        const { campaignName = 'ALL', month = '10', year = '2026', period = 'daily', metric = 'callsMade' } = req.query;
        const cacheKey = cache_1.CacheKeys.campaignMatrix(orgId, `${period}:${metric}:${campaignName}:${month}:${year}`);
        const cached = cache_1.serverCache.get(cacheKey);
        if (cached) {
            res.setHeader('X-Cache', 'HIT');
            res.status(200).json(cached);
            return;
        }
        const targetMonthIndex = parseInt(String(month || '10'), 10) - 1; // 0 to 11
        const targetYear = parseInt(String(year || '2026'), 10) || 2026;
        // 1. Fetch Registered Campaigns, Assignments, and Leads from DB
        const campaignModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'campaigns' });
        const assignmentModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'campaignassignments' });
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'leads' });
        let campaignDocs = [];
        if (campaignModule) {
            campaignDocs = await CustomRecord_1.default.find({ organizationId: orgId, moduleId: campaignModule._id }).lean();
        }
        const registeredCampaignNames = Array.from(new Set(campaignDocs.map((c) => {
            const d = c.data || {};
            return (d.campaignName || d.name || '').toString().trim();
        }).filter(Boolean)));
        // Fetch Campaign Assignments
        let assignmentDocs = [];
        if (assignmentModule) {
            assignmentDocs = await CustomRecord_1.default.find({ organizationId: orgId, moduleId: assignmentModule._id }).lean();
        }
        // Fetch Leads
        let leadDocs = [];
        if (leadModule) {
            leadDocs = await CustomRecord_1.default.find({ organizationId: orgId, moduleId: leadModule._id }).lean();
        }
        // Filter by selected campaign if specified
        let filteredAssignments = assignmentDocs;
        let filteredLeads = leadDocs;
        if (campaignName && campaignName !== 'ALL') {
            const campLower = String(campaignName).toLowerCase().trim();
            filteredAssignments = assignmentDocs.filter((a) => {
                const c = (a.data?.campaign || a.data?.campaignName || '').toString().toLowerCase().trim();
                return c === campLower;
            });
            filteredLeads = leadDocs.filter((l) => {
                const c = (l.data?.campaign || l.data?.campaignName || l.campaignName || '').toString().toLowerCase().trim();
                return c === campLower;
            });
        }
        // 2. Fetch Real Users from Organization and build strict canonical lookup
        const users = await User_1.default.find({ organizationId: orgId })
            .select('_id firstName lastName name username email')
            .lean();
        const callerLookup = new Map();
        const orderedCallersList = [];
        users.forEach((u) => {
            const full = u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : (u.name || u.username || u.email);
            if (full && !orderedCallersList.includes(full)) {
                orderedCallersList.push(full);
            }
            const lowerFull = full.toLowerCase().trim();
            callerLookup.set(lowerFull, full);
            if (u._id)
                callerLookup.set(String(u._id).toLowerCase().trim(), full);
            if (u.id)
                callerLookup.set(String(u.id).toLowerCase().trim(), full);
            if (u.email)
                callerLookup.set(u.email.toLowerCase().trim(), full);
            if (u.username)
                callerLookup.set(u.username.toLowerCase().trim(), full);
        });
        // Helper: Strictly resolve a lead/assignment to exactly one canonical caller name
        const resolveCallerName = (item) => {
            const d = item.data || {};
            const raw = d.assignedTo?.name || d.assignedTo?.email || d.assignedTo?._id || d.assignedTo || d.telecaller || item.assignedTo?.name || item.assignedTo || '';
            if (!raw)
                return null;
            const str = String(raw).trim();
            if (!str || str.toLowerCase() === 'unassigned' || str.toLowerCase() === 'n/a' || str.toLowerCase() === 'null') {
                return null;
            }
            const lower = str.toLowerCase();
            if (callerLookup.has(lower)) {
                return callerLookup.get(lower);
            }
            for (const c of orderedCallersList) {
                if (c.toLowerCase() === lower)
                    return c;
            }
            return str;
        };
        // Ensure all callers who have assigned leads appear in the list
        filteredLeads.forEach((l) => {
            const caller = resolveCallerName(l);
            if (caller && !orderedCallersList.includes(caller)) {
                orderedCallersList.push(caller);
            }
        });
        filteredAssignments.forEach((a) => {
            const caller = resolveCallerName(a);
            if (caller && !orderedCallersList.includes(caller)) {
                orderedCallersList.push(caller);
            }
        });
        const callerNames = orderedCallersList.length > 0 ? orderedCallersList : ['Super Admin', 'Telecaller'];
        // Helper: Determine if a lead has ACTUALLY been dialed / called
        // (A newly created lead in form without a call made is NOT dialed!)
        const isLeadDialed = (lead) => {
            const d = lead.data || {};
            if (d.dialedAt)
                return true;
            const callAttempts = Number(d.callAttempts || 0);
            if (callAttempts > 0)
                return true;
            const dialSt = (d.dialStatus || '').toString().toLowerCase().trim();
            if (dialSt && !['new', 'yet to call', 'unassigned', ''].includes(dialSt))
                return true;
            return false;
        };
        // Helper: Resolve the real date of an event (in Indian Standard Time)
        // NEVER uses followUpDate for calls made (followUpDate is a scheduled future date!)
        const getEventDateParts = (lead, metricType) => {
            const d = lead.data || {};
            let rawDate = null;
            if (metricType === 'callsMade' || metricType === 'leadsCalled') {
                rawDate = d.dialedAt || lead.updatedAt || lead.createdAt;
            }
            else if (metricType === 'hotLeads') {
                rawDate = d.hotDate || lead.updatedAt || lead.createdAt;
            }
            else if (metricType === 'logins') {
                rawDate = d.loginDate || lead.updatedAt || lead.createdAt;
            }
            else if (metricType === 'approved') {
                rawDate = d.approvalDate || lead.updatedAt || lead.createdAt;
            }
            else if (metricType === 'disbursed') {
                rawDate = d.disbursalDate || lead.updatedAt || lead.createdAt;
            }
            else {
                rawDate = d.dialedAt || lead.updatedAt || lead.createdAt;
            }
            if (!rawDate)
                return null;
            const dateObj = new Date(rawDate);
            if (isNaN(dateObj.getTime()))
                return null;
            // Guard against future timestamps due to clock skew or future scheduled dates
            const nowMs = Date.now();
            const eventMs = Math.min(dateObj.getTime(), nowMs);
            // Convert to Indian Standard Time (UTC + 5:30)
            const istMs = eventMs + (5.5 * 60 * 60 * 1000);
            const ist = new Date(istMs);
            return {
                day: ist.getUTCDate(), // 1 to 31
                month: ist.getUTCMonth(), // 0 to 11
                year: ist.getUTCFullYear()
            };
        };
        // Helper to check if lead matches a metric
        const isLeadMetricMatch = (l, m) => {
            const d = l.data || {};
            const st = (d.status || l.status || '').toString().toLowerCase();
            const cat = (d.leadCategory || '').toString().toLowerCase();
            if (m === 'callsMade')
                return isLeadDialed(l);
            if (m === 'leadsCalled')
                return isLeadDialed(l);
            if (m === 'hotLeads')
                return st.includes('hot') || cat.includes('hot');
            if (m === 'logins')
                return st.includes('login') || st.includes('document') || st.includes('cebil') || st.includes('approval pending') || !!d.loginDate || !!d.loginAmount;
            if (m === 'approved')
                return (st.includes('approv') && !st.includes('pending')) || st.includes('approved but not disbuse') || st === 'approved';
            if (m === 'disbursed')
                return st.includes('disbus') || st.includes('disburs') || st.includes('closed won');
            if (m === 'yetToCall')
                return !isLeadDialed(l);
            return true; // assigned, all
        };
        // 4. Generate Columns based on Period
        let columns = [];
        if (period === 'daily') {
            const daysInMonth = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
            columns = Array.from({ length: daysInMonth }, (_, i) => `Day ${String(i + 1).padStart(2, '0')}`);
        }
        else if (period === 'monthly') {
            columns = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        }
        else {
            columns = ['2024', '2025', '2026', '2027'];
        }
        // 5. Pre-bucket leads by canonical caller so EACH lead belongs to EXACTLY ONE caller
        const callerLeadsMap = new Map();
        const callerAssignsMap = new Map();
        callerNames.forEach(c => {
            callerLeadsMap.set(c, []);
            callerAssignsMap.set(c, []);
        });
        filteredLeads.forEach(l => {
            const caller = resolveCallerName(l);
            if (caller && callerLeadsMap.has(caller)) {
                callerLeadsMap.get(caller).push(l);
            }
        });
        filteredAssignments.forEach(a => {
            const caller = resolveCallerName(a);
            if (caller && callerAssignsMap.has(caller)) {
                callerAssignsMap.get(caller).push(a);
            }
        });
        // 6. Generate caller matrix rows for selected metric
        const rows = callerNames.map(callerName => {
            const userLeads = callerLeadsMap.get(callerName) || [];
            const userAssigns = callerAssignsMap.get(callerName) || [];
            const userDialed = userLeads.filter(isLeadDialed);
            const relevantLeads = userLeads.filter(l => isLeadMetricMatch(l, String(metric)));
            // Bucket relevant leads by date interval
            const leadsByDay = {};
            const leadsByMonth = {};
            const leadsByYear = {};
            relevantLeads.forEach(l => {
                const parts = getEventDateParts(l, String(metric));
                if (parts) {
                    if (parts.month === targetMonthIndex && parts.year === targetYear) {
                        if (!leadsByDay[parts.day])
                            leadsByDay[parts.day] = [];
                        leadsByDay[parts.day].push(l);
                    }
                    if (parts.year === targetYear) {
                        if (!leadsByMonth[parts.month])
                            leadsByMonth[parts.month] = [];
                        leadsByMonth[parts.month].push(l);
                    }
                    if (!leadsByYear[parts.year])
                        leadsByYear[parts.year] = [];
                    leadsByYear[parts.year].push(l);
                }
            });
            const rowData = {};
            let rowTotal = 0;
            columns.forEach((col, cIdx) => {
                let val = 0;
                if (period === 'daily') {
                    const dayNum = cIdx + 1; // 1 to 31
                    const dayLeads = leadsByDay[dayNum] || [];
                    if (metric === 'callsMade') {
                        val = dayLeads.reduce((sum, l) => sum + Math.max(1, Number(l.data?.callAttempts || 1)), 0);
                    }
                    else if (metric === 'targetAchievement' || metric === 'progressPct') {
                        val = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
                    }
                    else if (metric === 'yetToCall') {
                        val = dayLeads.filter(l => !isLeadDialed(l)).length;
                    }
                    else if (metric === 'campaignsAssigned') {
                        val = userAssigns.length > 0 ? 1 : 0;
                    }
                    else {
                        val = dayLeads.length;
                    }
                }
                else if (period === 'monthly') {
                    const monthLeads = leadsByMonth[cIdx] || [];
                    if (metric === 'callsMade') {
                        val = monthLeads.reduce((sum, l) => sum + Math.max(1, Number(l.data?.callAttempts || 1)), 0);
                    }
                    else if (metric === 'targetAchievement' || metric === 'progressPct') {
                        val = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
                    }
                    else if (metric === 'yetToCall') {
                        val = monthLeads.filter(l => !isLeadDialed(l)).length;
                    }
                    else if (metric === 'campaignsAssigned') {
                        val = userAssigns.length > 0 ? 1 : 0;
                    }
                    else {
                        val = monthLeads.length;
                    }
                }
                else {
                    // Annually
                    const yearVal = parseInt(col, 10);
                    const yearLeads = leadsByYear[yearVal] || [];
                    if (metric === 'callsMade') {
                        val = yearLeads.reduce((sum, l) => sum + Math.max(1, Number(l.data?.callAttempts || 1)), 0);
                    }
                    else if (metric === 'targetAchievement' || metric === 'progressPct') {
                        val = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
                    }
                    else if (metric === 'yetToCall') {
                        val = yearLeads.filter(l => !isLeadDialed(l)).length;
                    }
                    else if (metric === 'campaignsAssigned') {
                        val = userAssigns.length > 0 ? 1 : 0;
                    }
                    else {
                        val = yearLeads.length;
                    }
                }
                rowData[col] = val;
                if (metric !== 'targetAchievement' && metric !== 'progressPct') {
                    rowTotal += val;
                }
            });
            if (metric === 'targetAchievement' || metric === 'progressPct') {
                rowTotal = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
            }
            return {
                callerName,
                data: rowData,
                total: rowTotal
            };
        });
        // 7. Calculate Column Totals and Grand Total across callers
        const totals = {};
        let grandTotal = 0;
        columns.forEach(col => {
            const sum = rows.reduce((acc, r) => acc + (r.data[col] || 0), 0);
            if (metric === 'targetAchievement' || metric === 'progressPct') {
                totals[col] = rows.length > 0 ? Math.round(sum / rows.length) : 0;
            }
            else {
                totals[col] = sum;
                grandTotal += sum;
            }
        });
        // 8. Compute KPI Hero Summary cards strictly scoped to the active period
        // Filter leads that fall within the selected period (month/year for daily, year for monthly)
        const periodScopedLeads = filteredLeads.filter(l => {
            const parts = getEventDateParts(l, 'callsMade');
            if (!parts)
                return false;
            if (period === 'daily') {
                return parts.month === targetMonthIndex && parts.year === targetYear;
            }
            else if (period === 'monthly') {
                return parts.year === targetYear;
            }
            return true;
        });
        const periodDialedLeads = periodScopedLeads.filter(isLeadDialed);
        const periodCallsMade = periodDialedLeads.reduce((sum, l) => {
            const attempts = Number(l.data?.callAttempts || 0);
            return sum + Math.max(1, attempts);
        }, 0);
        const periodHotLeads = periodScopedLeads.filter(l => isLeadMetricMatch(l, 'hotLeads')).length;
        const periodLogins = periodScopedLeads.filter(l => isLeadMetricMatch(l, 'logins')).length;
        const periodApproved = periodScopedLeads.filter(l => isLeadMetricMatch(l, 'approved')).length;
        const periodDisbursed = periodScopedLeads.filter(l => isLeadMetricMatch(l, 'disbursed')).length;
        const totalLeadsAssignedCount = filteredAssignments.length > 0 ? filteredAssignments.length : filteredLeads.length;
        const campaignsAssignedCount = campaignName !== 'ALL'
            ? 1
            : (registeredCampaignNames.length > 0 ? registeredCampaignNames.length : 1);
        const targetBenchmark = Math.max(1, Math.ceil(totalLeadsAssignedCount * 0.15));
        const targetAchievementValue = periodDisbursed > 0
            ? Math.min(100, Math.round((periodDisbursed / targetBenchmark) * 100))
            : (totalLeadsAssignedCount > 0 ? Math.min(100, Math.round((periodDialedLeads.length / totalLeadsAssignedCount) * 100)) : 0);
        if (metric === 'targetAchievement' || metric === 'progressPct') {
            grandTotal = targetAchievementValue;
        }
        const responsePayload = {
            summary: {
                callsMade: periodCallsMade,
                hotLeads: periodHotLeads,
                logins: periodLogins,
                approved: periodApproved,
                disbursed: periodDisbursed,
                targetAchievement: targetAchievementValue,
                campaignsAssigned: campaignsAssignedCount,
                totalLeadsAssigned: totalLeadsAssignedCount,
                leadsCalled: periodDialedLeads.length,
                yetToCall: Math.max(0, totalLeadsAssignedCount - periodDialedLeads.length),
                progressPct: targetAchievementValue
            },
            matrix: {
                columns,
                rows,
                totals,
                grandTotal
            },
            campaignsList: registeredCampaignNames
        };
        cache_1.serverCache.set(cacheKey, responsePayload, 60);
        res.setHeader('X-Cache', 'MISS');
        res.status(200).json(responsePayload);
    }
    catch (error) {
        console.error('Campaign matrix aggregation error:', error);
        res.status(500).json({ error: error.message || 'Failed to aggregate campaign report data' });
    }
});
// 1. Get all report definitions
router.get('/', async (req, res) => {
    try {
        const reports = await ReportDefinition_1.default.find({ organizationId: req.organizationId });
        const moduleIds = [...new Set(reports.map((r) => r.moduleId).filter(Boolean))];
        let moduleMap = new Map();
        if (moduleIds.length > 0) {
            const modules = await ModuleDefinition_1.default.find({ _id: { $in: moduleIds } });
            moduleMap = new Map(modules.map((m) => [m._id || m.id, m]));
        }
        const populated = reports.map((r) => {
            const doc = { ...r };
            const mod = moduleMap.get(r.moduleId);
            if (mod) {
                doc.moduleId = {
                    _id: mod._id || mod.id,
                    id: mod._id || mod.id,
                    name: mod.name,
                    pluralLabel: mod.pluralLabel,
                    singularLabel: mod.singularLabel
                };
            }
            return doc;
        });
        res.status(200).json(populated);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to retrieve reports.' });
    }
});
// 2. Create/Save a report definition
router.post('/', async (req, res) => {
    try {
        const { name, description, moduleId, chartType, groupByField, metricField, aggregation, filters, columns } = req.body;
        if (!name || !moduleId || !chartType) {
            res.status(400).json({ error: 'Name, moduleId, and chartType are required.' });
            return;
        }
        const report = await ReportDefinition_1.default.create({
            organizationId: req.organizationId,
            moduleId,
            name,
            description,
            chartType,
            groupByField,
            metricField,
            aggregation,
            filters: filters || [],
            columns: columns || [],
            createdBy: req.user?.id
        });
        res.status(201).json(report);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to save report definition.' });
    }
});
// 3. Execute/Run a report (aggregating metrics & generating details)
router.get('/:id/run', async (req, res) => {
    try {
        const report = await ReportDefinition_1.default.findOne({
            _id: req.params.id,
            organizationId: req.organizationId
        });
        if (!report) {
            res.status(404).json({ error: 'Report definition not found.' });
            return;
        }
        if (report.moduleId) {
            const mod = await ModuleDefinition_1.default.findById(report.moduleId);
            if (mod) {
                report.module = {
                    _id: mod._id || mod.id,
                    id: mod._id || mod.id,
                    name: mod.name,
                    pluralLabel: mod.pluralLabel,
                    singularLabel: mod.singularLabel
                };
            }
        }
        // Generate chart aggregation data
        const chartData = await reportBuilder_1.ReportBuilderService.generateReport(report, req.user);
        // Generate detailed table rows
        const details = await reportBuilder_1.ReportBuilderService.getReportDetails(report, req.user);
        res.status(200).json({
            report,
            chartData,
            details
        });
    }
    catch (error) {
        console.error('Run Report Error:', error);
        res.status(500).json({ error: 'Failed to execute report aggregations.' });
    }
});
// 4. Delete report definition
router.delete('/:id', async (req, res) => {
    try {
        const report = await ReportDefinition_1.default.findOneAndDelete({
            _id: req.params.id,
            organizationId: req.organizationId
        });
        if (!report) {
            res.status(404).json({ error: 'Report not found.' });
            return;
        }
        res.status(200).json({ message: 'Report definition deleted successfully.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete report.' });
    }
});
exports.default = router;
