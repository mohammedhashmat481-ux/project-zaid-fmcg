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
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authenticate);
router.use(tenantMiddleware_1.requireTenant);
// Campaign Daily, Monthly, Annually Matrix Report API Endpoint (Real Database Aggregation)
router.get('/campaign-matrix', async (req, res) => {
    try {
        const orgId = req.organizationId;
        const { campaignName = 'ALL', month = '10', year = '2026', period = 'daily', metric = 'callsMade' } = req.query;
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
        // 2. Fetch Real Users from Organization
        const users = await User_1.default.find({ organizationId: orgId })
            .select('firstName lastName name username email')
            .lean();
        const callerNamesSet = new Set();
        users.forEach((u) => {
            const full = u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : u.name || u.username;
            if (full)
                callerNamesSet.add(full);
        });
        // Also include any callers present in lead/assignment records
        filteredLeads.forEach((l) => {
            const assigned = l.data?.assignedTo || l.data?.telecaller || l.assignedTo?.name;
            if (assigned && typeof assigned === 'string' && assigned !== 'N/A' && assigned !== 'Unassigned') {
                callerNamesSet.add(assigned);
            }
        });
        filteredAssignments.forEach((a) => {
            const assigned = a.data?.assignedTo;
            if (assigned && typeof assigned === 'string' && assigned !== 'N/A' && assigned !== 'Unassigned') {
                callerNamesSet.add(assigned);
            }
        });
        const callerNames = Array.from(callerNamesSet);
        if (callerNames.length === 0) {
            callerNames.push('Admin', 'Telecaller');
        }
        // Helper: Match caller on record
        const matchesCaller = (item, caller) => {
            const d = item.data || {};
            const assigned = (d.assignedTo?.name || d.assignedTo || d.telecaller || item.assignedTo?.name || '').toString().toLowerCase().trim();
            const target = caller.toLowerCase().trim();
            return assigned === target || assigned.includes(target) || target.includes(assigned);
        };
        // Helper: Determine if lead is dialed/called
        const isLeadDialed = (lead) => {
            const d = lead.data || {};
            const st = (d.status || lead.status || '').toString().toLowerCase();
            const dialSt = (d.dialStatus || '').toString().toLowerCase();
            const callAttempts = Number(d.callAttempts || 0);
            const isNotCalled = ['new', 'yet to call', 'unassigned', ''].includes(st) && (!dialSt || dialSt === 'yet to call' || dialSt === 'new');
            return !isNotCalled || callAttempts > 0 || !!d.dialedAt;
        };
        // 3. Compute the 6 KPI Hero Cards from REAL Database Records
        const campaignsAssignedCount = campaignName !== 'ALL'
            ? 1
            : (registeredCampaignNames.length > 0 ? registeredCampaignNames.length : 1);
        const totalLeadsAssignedCount = filteredAssignments.length > 0 ? filteredAssignments.length : filteredLeads.length;
        const dialedLeads = filteredLeads.filter(isLeadDialed);
        const leadsCalledCount = dialedLeads.length;
        const yetToCallCount = Math.max(0, totalLeadsAssignedCount - leadsCalledCount);
        // 1. CALLS MADE: sum callAttempts or dialed leads count
        const callsMadeCount = dialedLeads.reduce((sum, l) => {
            const attempts = Number(l.data?.callAttempts || 0);
            return sum + (attempts > 0 ? attempts : 1);
        }, 0);
        // 2. HOT LEADS: leads with HOT LEADS status or hot category
        const hotLeads = filteredLeads.filter((l) => {
            const st = (l.data?.status || l.status || '').toString().toLowerCase();
            const cat = (l.data?.leadCategory || '').toString().toLowerCase();
            return st.includes('hot') || cat.includes('hot');
        });
        const hotLeadsCount = hotLeads.length;
        // 3. LOGINS: files / applications submitted for banking credit approval
        const loginLeads = filteredLeads.filter((l) => {
            const st = (l.data?.status || l.status || '').toString().toLowerCase();
            return st.includes('login') || st.includes('document') || st.includes('cebil') || st.includes('approval pending') || !!l.data?.loginDate || !!l.data?.loginAmount;
        });
        const loginsCount = loginLeads.length;
        // 4. APPROVED: loans sanctioned / approved by partner banks
        const approvedLeads = filteredLeads.filter((l) => {
            const st = (l.data?.status || l.status || '').toString().toLowerCase();
            return (st.includes('approv') && !st.includes('pending')) || st.includes('approved but not disbuse') || st === 'approved';
        });
        const approvedCount = approvedLeads.length;
        // 5. DISBURSED: loans successfully disbursed to customers (closed won)
        const disbursedLeads = filteredLeads.filter((l) => {
            const st = (l.data?.status || l.status || '').toString().toLowerCase();
            return st.includes('disbus') || st.includes('disburs') || st.includes('closed won');
        });
        const disbursedCount = disbursedLeads.length;
        // 6. TARGET ACHIEVEMENT: percentage of goal achieved
        const targetBenchmark = Math.max(1, Math.ceil(totalLeadsAssignedCount * 0.15));
        const targetAchievementValue = disbursedCount > 0
            ? Math.min(100, Math.round((disbursedCount / targetBenchmark) * 100))
            : (totalLeadsAssignedCount > 0 ? Math.min(100, Math.round((leadsCalledCount / totalLeadsAssignedCount) * 100)) : 0);
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
        // 5. Generate caller rows and real values for the selected metric
        const rows = callerNames.map(callerName => {
            const userLeads = filteredLeads.filter((l) => matchesCaller(l, callerName));
            const userAssigns = filteredAssignments.filter((a) => matchesCaller(a, callerName));
            const userDialed = userLeads.filter(isLeadDialed);
            const rowData = {};
            let rowTotal = 0;
            // Filter relevant leads for this metric
            let relevantLeads = userLeads;
            if (metric === 'callsMade') {
                relevantLeads = userDialed;
            }
            else if (metric === 'hotLeads') {
                relevantLeads = userLeads.filter((l) => {
                    const st = (l.data?.status || l.status || '').toString().toLowerCase();
                    return st.includes('hot');
                });
            }
            else if (metric === 'logins') {
                relevantLeads = userLeads.filter((l) => {
                    const st = (l.data?.status || l.status || '').toString().toLowerCase();
                    return st.includes('login') || st.includes('document') || st.includes('cebil') || st.includes('approval pending');
                });
            }
            else if (metric === 'approved') {
                relevantLeads = userLeads.filter((l) => {
                    const st = (l.data?.status || l.status || '').toString().toLowerCase();
                    return (st.includes('approv') && !st.includes('pending')) || st.includes('approved but not disbuse') || st === 'approved';
                });
            }
            else if (metric === 'disbursed') {
                relevantLeads = userLeads.filter((l) => {
                    const st = (l.data?.status || l.status || '').toString().toLowerCase();
                    return st.includes('disbus') || st.includes('disburs') || st.includes('closed won');
                });
            }
            else if (metric === 'yetToCall' || metric === 'assigned') {
                relevantLeads = userLeads;
            }
            // Map leads by date
            const leadsByDay = {};
            const leadsByMonth = {};
            const leadsByYear = {};
            relevantLeads.forEach((l) => {
                const rawDate = l.data?.dialedAt || l.data?.followUpDate || l.updatedAt || l.createdAt;
                if (rawDate) {
                    const d = new Date(rawDate);
                    if (!isNaN(d.getTime())) {
                        const dayNum = d.getDate(); // 1-31
                        const monthNum = d.getMonth(); // 0-11
                        const yearNum = d.getFullYear(); // e.g. 2026
                        // For daily, only include if same month & year as selected
                        if (monthNum === targetMonthIndex && yearNum === targetYear) {
                            if (!leadsByDay[dayNum])
                                leadsByDay[dayNum] = [];
                            leadsByDay[dayNum].push(l);
                        }
                        // For monthly, only include if same year as selected
                        if (yearNum === targetYear) {
                            if (!leadsByMonth[monthNum])
                                leadsByMonth[monthNum] = [];
                            leadsByMonth[monthNum].push(l);
                        }
                        // For annual, include by year
                        if (!leadsByYear[yearNum])
                            leadsByYear[yearNum] = [];
                        leadsByYear[yearNum].push(l);
                    }
                }
            });
            columns.forEach((col, cIdx) => {
                let val = 0;
                if (period === 'daily') {
                    const dayNum = cIdx + 1; // 1 to 31
                    const dayLeads = leadsByDay[dayNum] || [];
                    if (metric === 'callsMade') {
                        val = dayLeads.reduce((sum, l) => sum + Math.max(1, Number(l.data?.callAttempts || 1)), 0);
                    }
                    else if (metric === 'hotLeads') {
                        val = dayLeads.length;
                    }
                    else if (metric === 'logins') {
                        val = dayLeads.length;
                    }
                    else if (metric === 'approved') {
                        val = dayLeads.length;
                    }
                    else if (metric === 'disbursed') {
                        val = dayLeads.length;
                    }
                    else if (metric === 'targetAchievement') {
                        val = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
                    }
                    else if (metric === 'leadsCalled') {
                        val = dayLeads.length;
                    }
                    else if (metric === 'yetToCall') {
                        val = dayLeads.filter((l) => !isLeadDialed(l)).length;
                    }
                    else if (metric === 'assigned') {
                        val = dayLeads.length;
                    }
                    else if (metric === 'progressPct') {
                        val = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
                    }
                    else if (metric === 'campaignsAssigned') {
                        val = userAssigns.length > 0 ? 1 : 0;
                    }
                }
                else if (period === 'monthly') {
                    const monthLeads = leadsByMonth[cIdx] || [];
                    if (metric === 'callsMade') {
                        val = monthLeads.reduce((sum, l) => sum + Math.max(1, Number(l.data?.callAttempts || 1)), 0);
                    }
                    else if (metric === 'hotLeads') {
                        val = monthLeads.length;
                    }
                    else if (metric === 'logins') {
                        val = monthLeads.length;
                    }
                    else if (metric === 'approved') {
                        val = monthLeads.length;
                    }
                    else if (metric === 'disbursed') {
                        val = monthLeads.length;
                    }
                    else if (metric === 'targetAchievement') {
                        val = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
                    }
                    else if (metric === 'leadsCalled') {
                        val = monthLeads.length;
                    }
                    else if (metric === 'yetToCall') {
                        val = Math.max(0, userLeads.length - userDialed.length);
                    }
                    else if (metric === 'assigned') {
                        val = monthLeads.length;
                    }
                    else if (metric === 'progressPct') {
                        val = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
                    }
                    else if (metric === 'campaignsAssigned') {
                        val = userAssigns.length > 0 ? 1 : 0;
                    }
                }
                else {
                    // Annual
                    const yearVal = parseInt(col, 10);
                    const yearLeads = leadsByYear[yearVal] || [];
                    if (metric === 'callsMade') {
                        val = yearLeads.reduce((sum, l) => sum + Math.max(1, Number(l.data?.callAttempts || 1)), 0);
                    }
                    else if (metric === 'hotLeads') {
                        val = yearLeads.length;
                    }
                    else if (metric === 'logins') {
                        val = yearLeads.length;
                    }
                    else if (metric === 'approved') {
                        val = yearLeads.length;
                    }
                    else if (metric === 'disbursed') {
                        val = yearLeads.length;
                    }
                    else if (metric === 'targetAchievement') {
                        val = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
                    }
                    else if (metric === 'leadsCalled') {
                        val = yearLeads.length;
                    }
                    else if (metric === 'yetToCall') {
                        val = Math.max(0, userLeads.length - userDialed.length);
                    }
                    else if (metric === 'assigned') {
                        val = yearLeads.length;
                    }
                    else if (metric === 'progressPct') {
                        val = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
                    }
                    else if (metric === 'campaignsAssigned') {
                        val = userAssigns.length > 0 ? 1 : 0;
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
        // Calculate Column Totals across callers
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
        if (metric === 'targetAchievement' || metric === 'progressPct') {
            grandTotal = targetAchievementValue;
        }
        res.status(200).json({
            summary: {
                callsMade: callsMadeCount,
                hotLeads: hotLeadsCount,
                logins: loginsCount,
                approved: approvedCount,
                disbursed: disbursedCount,
                targetAchievement: targetAchievementValue,
                campaignsAssigned: campaignsAssignedCount,
                totalLeadsAssigned: totalLeadsAssignedCount,
                leadsCalled: leadsCalledCount,
                yetToCall: yetToCallCount,
                progressPct: targetAchievementValue
            },
            matrix: {
                columns,
                rows,
                totals,
                grandTotal
            },
            campaignsList: registeredCampaignNames
        });
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
