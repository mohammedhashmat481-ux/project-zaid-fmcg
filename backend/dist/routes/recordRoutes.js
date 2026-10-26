"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PIPELINE_LEAD_STATUS_REGEX = void 0;
exports.getStatusSynonyms = getStatusSynonyms;
const express_1 = require("express");
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
const Role_1 = __importDefault(require("../models/Role"));
const User_1 = __importDefault(require("../models/User"));
const Activity_1 = __importDefault(require("../models/Activity"));
const AuditLog_1 = __importDefault(require("../models/AuditLog"));
const formulaEvaluator_1 = require("../services/formulaEvaluator");
const workflowEngine_1 = require("../services/workflowEngine");
const notificationHelper_1 = require("../utils/notificationHelper");
const authMiddleware_1 = require("../middleware/authMiddleware");
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const hierarchy_1 = require("../utils/hierarchy");
const router = (0, express_1.Router)();
// Apply security middlewares
router.use(authMiddleware_1.authenticate);
router.use(tenantMiddleware_1.requireTenant);
// Helper: Check Role Permission dynamically
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
// Helper: Check Role Permission dynamically
const authorizeModuleAction = async (req, res, moduleName, action) => {
    try {
        const role = await Role_1.default.findById(req.user?.roleId);
        if (!role)
            return { allowed: false, scope: 'none' };
        // Super Admin bypass
        if (role.name === 'Super Admin' && role.isSystem) {
            return { allowed: true, scope: 'all' };
        }
        // Allow reading settings/metadata modules (Departments, Bank Masters, Products, etc.)
        const settingsModules = ['departments', 'bankmasters', 'bankingpartners', 'products'];
        if (action === 'read' && settingsModules.includes(moduleName.toLowerCase())) {
            return { allowed: true, scope: 'all' };
        }
        const permission = role.permissions.modules.find((m) => matchModuleName(m.moduleName, moduleName));
        if (!permission)
            return { allowed: false, scope: 'none' };
        if (action === 'create') {
            return { allowed: permission.create, scope: 'all' };
        }
        const scope = permission[action]; // 'all' | 'own' | 'none'
        return {
            allowed: scope !== 'none',
            scope: scope === 'none' ? 'none' : scope
        };
    }
    catch (err) {
        return { allowed: false, scope: 'none' };
    }
};
// Helper: Validate dynamic record fields
const validateFields = (fields, data, oldValues) => {
    const errors = [];
    fields.forEach((field) => {
        const val = data[field.name];
        // Check required fields
        if (field.required && (val === undefined || val === null || val === '')) {
            const wasAlreadyEmpty = oldValues && (oldValues[field.name] === undefined || oldValues[field.name] === null || oldValues[field.name] === '');
            if (!wasAlreadyEmpty) {
                errors.push(`Field '${field.label}' is required.`);
                return;
            }
        }
        if (val !== undefined && val !== null && val !== '') {
            // Check data types
            if (field.type === 'number' || field.type === 'currency') {
                if (isNaN(Number(val))) {
                    errors.push(`Field '${field.label}' must be a valid number.`);
                }
            }
            if (field.type === 'email') {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(String(val))) {
                    errors.push(`Field '${field.label}' must be a valid email address.`);
                }
            }
            if (field.regexValidation) {
                try {
                    const rx = new RegExp(field.regexValidation);
                    if (!rx.test(String(val))) {
                        errors.push(`Field '${field.label}' does not match validation pattern.`);
                    }
                }
                catch (e) {
                    // ignore invalid regex configuration on database side
                }
            }
        }
    });
    return errors;
};
// ── Special Campaign Assignment Aggregations ─────────────────────────────────
router.get('/campaigns/allocation-stats', async (req, res) => {
    try {
        const orgId = req.organizationId;
        // Find Lead Module Definition
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'leads' });
        if (!leadModule) {
            res.status(200).json({ stats: {}, dialedStats: {} });
            return;
        }
        // Aggregate count of leads grouped by assignedTo
        const stats = await CustomRecord_1.default.aggregate([
            { $match: { organizationId: orgId, moduleId: leadModule._id } },
            { $group: { _id: '$data.assignedTo', count: { $sum: 1 } } }
        ]);
        // Aggregate count of dialed leads
        const dialedStats = await CustomRecord_1.default.aggregate([
            {
                $match: {
                    organizationId: orgId,
                    moduleId: leadModule._id,
                    $or: [
                        { 'data.dialStatus': { $exists: true, $nin: ['Yet To Call', ''] } },
                        { 'data.status': { $nin: ['New', 'Yet To Call', ''] } },
                        { 'data.callAttempts': { $gt: 0 } }
                    ]
                }
            },
            { $group: { _id: '$data.assignedTo', count: { $sum: 1 } } }
        ]);
        const statsMap = {};
        stats.forEach((item) => {
            if (item._id) {
                statsMap[item._id.toString()] = item.count;
            }
        });
        const dialedMap = {};
        dialedStats.forEach((item) => {
            if (item._id) {
                dialedMap[item._id.toString()] = item.count;
            }
        });
        // Campaign-level stats (by campaign name) - only include registered campaigns in org
        const campaignModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'campaigns' });
        let campaignRecords = [];
        if (campaignModule) {
            campaignRecords = await CustomRecord_1.default.find({
                organizationId: orgId,
                moduleId: campaignModule._id
            }).lean();
        }
        const registeredCampaignNames = new Set(campaignRecords.map((c) => {
            const d = c.data || {};
            return (d.campaignName || d.name || d.source || '').toString().trim().toLowerCase();
        }).filter(Boolean));
        const allLeads = await CustomRecord_1.default.find({
            organizationId: orgId,
            moduleId: leadModule._id,
            $or: [
                { 'data.source': { $exists: true, $ne: '' } },
                { 'data.campaignName': { $exists: true, $ne: '' } },
                { 'data.campaign': { $exists: true, $ne: '' } },
                { 'data.campaign_name': { $exists: true, $ne: '' } }
            ]
        }).lean();
        const campaignAllocatedStats = {};
        const campaignDialedStats = {};
        allLeads.forEach((lead) => {
            const d = lead.data || {};
            const campName = (d.campaignName ||
                d.campaign ||
                d.campaign_name ||
                d.source)?.toString().trim();
            if (campName) {
                const lower = campName.toLowerCase();
                const genericSources = ['website', 'referral', 'cold call', 'social media', 'google ads', 'facebook ads', 'walk-in', 'direct'];
                const isRegistered = registeredCampaignNames.size === 0 || registeredCampaignNames.has(lower);
                if (isRegistered && (registeredCampaignNames.has(lower) || !genericSources.includes(lower))) {
                    campaignAllocatedStats[lower] = (campaignAllocatedStats[lower] || 0) + 1;
                    const dialSt = (d.dialStatus || '').toString().trim().toLowerCase();
                    const st = (d.status || '').toString().trim().toLowerCase();
                    const hasDialStatus = dialSt && dialSt !== 'yet to call' && dialSt !== 'not called' && dialSt !== 'new';
                    const hasDialedStatus = st && st !== 'new' && st !== 'yet to call' && st !== 'not called';
                    const hasCalls = (d.callAttempts && Number(d.callAttempts) > 0) || !!d.dialedAt;
                    if (hasDialedStatus || (hasCalls && hasDialStatus)) {
                        campaignDialedStats[lower] = (campaignDialedStats[lower] || 0) + 1;
                    }
                }
            }
        });
        res.status(200).json({
            stats: statsMap,
            dialedStats: dialedMap,
            campaignAllocatedStats,
            campaignDialedStats
        });
    }
    catch (error) {
        console.error('Failed to get allocation stats:', error);
        res.status(500).json({ error: 'Failed to get allocation stats.' });
    }
});
// ── Lead Bulk Import Endpoint ──────────────────────────────────────────
router.post('/leads/bulk-import', async (req, res) => {
    try {
        const orgId = req.organizationId;
        const userId = req.user?.id;
        const { leads, campaignName, defaultStatus, assignedTo, columnMapping } = req.body;
        if (!Array.isArray(leads) || leads.length === 0) {
            res.status(400).json({ error: 'Leads array is required and cannot be empty.' });
            return;
        }
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'leads' });
        if (!leadModule) {
            res.status(404).json({ error: 'Leads module definition not found.' });
            return;
        }
        const agentsList = Array.isArray(assignedTo) ? assignedTo : (assignedTo ? [assignedTo] : []);
        const recordsToCreate = [];
        leads.forEach((row, idx) => {
            const dataObj = {};
            if (columnMapping && typeof columnMapping === 'object') {
                Object.keys(columnMapping).forEach((rawCol) => {
                    const targetField = columnMapping[rawCol];
                    if (targetField && targetField !== 'ignore' && row[rawCol] !== undefined) {
                        dataObj[targetField] = row[rawCol];
                    }
                });
            }
            else {
                Object.assign(dataObj, row);
            }
            let fName = dataObj.firstName || dataObj.name || dataObj.customer || dataObj.costomer || dataObj.customer_name || 'Unnamed';
            let lName = dataObj.lastName || '';
            if (!dataObj.lastName && fName && String(fName).trim().includes(' ')) {
                const parts = String(fName).trim().split(' ');
                fName = parts[0];
                lName = parts.slice(1).join(' ');
            }
            let assignedAgent = dataObj.assignedTo || '';
            if (agentsList.length > 0) {
                assignedAgent = agentsList[idx % agentsList.length];
            }
            recordsToCreate.push({
                organizationId: orgId,
                moduleId: leadModule._id,
                createdBy: userId,
                updatedBy: userId,
                data: {
                    ...dataObj,
                    firstName: String(fName).trim(),
                    lastName: String(lName).trim(),
                    phone: String(dataObj.phone || dataObj.mobile || dataObj.contact || dataObj.contact_num || dataObj.phone_number || '').trim(),
                    email: String(dataObj.email || dataObj.mail || '').trim(),
                    company: String(dataObj.company || dataObj.firm_name || dataObj.firmName || dataObj.firm || '').trim(),
                    status: dataObj.status || defaultStatus || 'New',
                    dialStatus: dataObj.dialStatus || 'Yet To Call',
                    source: campaignName || dataObj.source || dataObj.campaignName || 'Excel Import',
                    assignedTo: assignedAgent,
                    budget: dataObj.budget || dataObj.amount || '',
                    loanType: dataObj.loanType || dataObj.category || '',
                    city: dataObj.city || dataObj.location || '',
                    state: dataObj.state || '',
                    notes: dataObj.notes || dataObj.remarks || ''
                }
            });
        });
        const inserted = await CustomRecord_1.default.insertMany(recordsToCreate);
        await AuditLog_1.default.create({
            organizationId: orgId,
            userId: String(userId),
            action: 'lead.bulk_import',
            resource: 'Leads',
            resourceId: String(leadModule._id),
            newValue: { count: inserted.length, campaignName }
        });
        res.status(201).json({
            success: true,
            count: inserted.length,
            message: `Successfully imported ${inserted.length} lead(s).`
        });
    }
    catch (error) {
        console.error('Failed to bulk import leads:', error);
        res.status(500).json({ error: error.message || 'Failed to bulk import leads.' });
    }
});
// ── Lead Bulk Delete Endpoint ──────────────────────────────────────────
router.post('/leads/bulk-delete', async (req, res) => {
    try {
        const orgId = req.organizationId;
        const userId = req.user?.id;
        const { leadIds, filters, deleteAllMatching } = req.body;
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'leads' });
        if (!leadModule) {
            res.status(404).json({ error: 'Leads module definition not found.' });
            return;
        }
        const { allowed } = await authorizeModuleAction(req, res, leadModule.name, 'delete');
        if (!allowed) {
            res.status(403).json({ error: 'Access denied: You do not have permission to delete leads.' });
            return;
        }
        const query = {
            organizationId: orgId,
            moduleId: leadModule._id
        };
        if (Array.isArray(leadIds) && leadIds.length > 0) {
            query._id = { $in: leadIds };
        }
        else if (deleteAllMatching && filters) {
            const conditions = [];
            if (filters.campaignName) {
                conditions.push({ 'data.source': filters.campaignName });
                conditions.push({ 'data.campaignName': filters.campaignName });
            }
            if (filters.status) {
                query['data.status'] = filters.status;
            }
            if (filters.assignedTo) {
                query['data.assignedTo'] = filters.assignedTo;
            }
            if (filters.source) {
                query['data.source'] = filters.source;
            }
            if (filters.startDate || filters.endDate) {
                query.createdAt = {};
                if (filters.startDate)
                    query.createdAt.$gte = new Date(filters.startDate);
                if (filters.endDate) {
                    const end = new Date(filters.endDate);
                    end.setHours(23, 59, 59, 999);
                    query.createdAt.$lte = end;
                }
            }
            if (filters.searchQuery) {
                const rx = new RegExp(filters.searchQuery, 'i');
                query.$or = [
                    { 'data.firstName': rx },
                    { 'data.lastName': rx },
                    { 'data.phone': rx },
                    { 'data.email': rx },
                    { 'data.company': rx }
                ];
            }
            if (conditions.length > 0) {
                if (query.$or) {
                    query.$and = [{ $or: query.$or }, { $or: conditions }];
                    delete query.$or;
                }
                else {
                    query.$or = conditions;
                }
            }
        }
        else {
            res.status(400).json({ error: 'Please specify leadIds array or set deleteAllMatching to true with filters.' });
            return;
        }
        const result = await CustomRecord_1.default.deleteMany(query);
        await AuditLog_1.default.create({
            organizationId: orgId,
            userId: String(userId),
            action: 'lead.bulk_delete',
            resource: 'Leads',
            resourceId: String(leadModule._id),
            oldValue: { deletedCount: result.deletedCount, filters, leadIdsCount: leadIds?.length }
        });
        res.status(200).json({
            success: true,
            count: result.deletedCount,
            message: `Successfully deleted ${result.deletedCount} lead(s).`
        });
    }
    catch (error) {
        console.error('Failed to bulk delete leads:', error);
        res.status(500).json({ error: error.message || 'Failed to bulk delete leads.' });
    }
});
// ── Lead Filters Metadata Endpoint ──────────────────────────────────────────
router.get('/leads/filters-meta', async (req, res) => {
    try {
        const orgId = req.organizationId;
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'leads' });
        if (!leadModule) {
            res.status(200).json({ campaigns: [], statuses: [], sources: [], totalLeads: 0 });
            return;
        }
        const records = await CustomRecord_1.default.find({ organizationId: orgId, moduleId: leadModule._id }).lean();
        const campaignsSet = new Set();
        const statusesSet = new Set();
        const sourcesSet = new Set();
        records.forEach((r) => {
            if (r.data?.source) {
                campaignsSet.add(r.data.source);
                sourcesSet.add(r.data.source);
            }
            if (r.data?.campaign)
                campaignsSet.add(r.data.campaign);
            if (r.data?.campaignName)
                campaignsSet.add(r.data.campaignName);
            if (r.data?.status)
                statusesSet.add(r.data.status);
        });
        res.status(200).json({
            campaigns: Array.from(campaignsSet).filter(Boolean),
            statuses: Array.from(statusesSet).filter(Boolean),
            sources: Array.from(sourcesSet).filter(Boolean),
            totalLeads: records.length
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch lead filter metadata.' });
    }
});
router.post('/campaigns/bulk-assign', async (req, res) => {
    try {
        const orgId = req.organizationId;
        const userId = req.user?.id;
        const { campaignName, agentNames, leads } = req.body;
        if (!campaignName || !agentNames || !Array.isArray(agentNames) || agentNames.length === 0 || !Array.isArray(leads) || leads.length === 0) {
            res.status(400).json({ error: 'campaignName, agentNames, and leads array are required.' });
            return;
        }
        // Clean and validate agent names
        const cleanAgents = agentNames
            .map((a) => String(a || '').trim())
            .filter(Boolean);
        if (cleanAgents.length === 0) {
            res.status(400).json({ error: 'At least one valid agent name is required.' });
            return;
        }
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'leads' });
        if (!leadModule) {
            res.status(404).json({ error: 'Leads module definition not found.' });
            return;
        }
        // Strict equal distribution calculation
        const totalLeads = leads.length;
        const numAgents = cleanAgents.length;
        const basePerAgent = Math.floor(totalLeads / numAgents);
        const remainder = totalLeads % numAgents;
        // Track assigned counts per agent
        const agentCounts = {};
        cleanAgents.forEach(a => { agentCounts[a] = 0; });
        // Distribute leads among agents
        const recordsToCreate = [];
        leads.forEach((lead, idx) => {
            // Balanced round-robin: for N leads and M agents, each gets Math.floor(N/M) + (idx < remainder ? 1 : 0)
            const assignedAgent = cleanAgents[idx % numAgents];
            agentCounts[assignedAgent] = (agentCounts[assignedAgent] || 0) + 1;
            // Parse names — support multiple column name formats
            let fName = lead.firstName || lead.name || lead.costomer || lead.customer || lead.customer_name || 'Unnamed';
            let lName = lead.lastName || '';
            if (!lead.lastName && fName && fName.includes(' ')) {
                const parts = fName.split(' ');
                fName = parts[0];
                lName = parts.slice(1).join(' ');
            }
            recordsToCreate.push({
                organizationId: orgId,
                moduleId: leadModule._id,
                createdBy: userId,
                updatedBy: userId,
                data: {
                    firstName: fName,
                    lastName: lName,
                    phone: lead.phone || lead.mobile || lead.name_contact_num || lead.contact_num || lead.contact || '',
                    email: lead.email || '',
                    loanType: lead.loanType || lead.lead_category || lead.category || '',
                    budget: lead.budget || lead.amount || '',
                    company: lead.company || lead.firm_name || lead.firmName || lead.firm || '',
                    salary: lead.salary || '',
                    city: lead.city || lead.location || '',
                    state: lead.state || '',
                    dataCode: lead.dataCode || lead.data_code || '',
                    caseDetails: lead.caseDetails || lead.case_status || lead.case_details || '',
                    notes: lead.notes || lead.remarks || lead.remark || '',
                    status: lead.status || 'New',
                    dialStatus: 'Yet To Call',
                    source: campaignName, // Set source as campaign name
                    campaign: campaignName,
                    campaignName: campaignName,
                    assignedTo: assignedAgent, // Set agent name
                    fullName: `${fName} ${lName}`.trim(),
                    customerName: `${fName} ${lName}`.trim()
                }
            });
        });
        // Bulk insert custom records
        const result = await CustomRecord_1.default.insertMany(recordsToCreate);
        // Create Audit Log
        await AuditLog_1.default.create({
            organizationId: orgId,
            userId: userId,
            action: 'campaign.bulk_assign',
            resource: 'leads',
            details: {
                campaignName,
                agentCount: numAgents,
                assignedCount: result.length,
                breakdown: agentCounts
            }
        });
        // Generate notifications for assigned agents
        for (const [agentName, count] of Object.entries(agentCounts)) {
            if (count > 0) {
                await (0, notificationHelper_1.createNotification)({
                    organizationId: orgId,
                    recipient: agentName,
                    title: 'Campaign Leads Allocated',
                    message: `${count} lead(s) from campaign '${campaignName}' were allocated to you.`,
                    type: 'info',
                    link: '/my-campaign'
                });
            }
        }
        const equalText = remainder === 0
            ? `equally (${basePerAgent} leads each)`
            : `(${basePerAgent} leads each, with ${remainder} remainder distributed)`;
        const message = `Successfully assigned ${result.length} leads to ${numAgents} agents ${equalText}.`;
        res.status(201).json({
            message,
            totalAssigned: result.length,
            agentCount: numAgents,
            basePerAgent,
            remainder,
            breakdown: agentCounts
        });
    }
    catch (error) {
        console.error('Failed to bulk assign leads:', error);
        res.status(500).json({ error: error.message || 'Failed to bulk assign leads.' });
    }
});
// GET my campaigns (assigned to logged in user)
router.get('/campaigns/my-campaigns', async (req, res) => {
    try {
        const orgId = req.organizationId;
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized.' });
            return;
        }
        // 1. Get registered campaigns from the Campaigns module
        const campaignModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'campaigns' });
        let campaignRecords = [];
        if (campaignModule) {
            campaignRecords = await CustomRecord_1.default.find({
                organizationId: orgId,
                moduleId: campaignModule._id
            }).lean();
        }
        const registeredCampaignNames = new Set(campaignRecords.map((c) => {
            const d = c.data || {};
            return (d.campaignName || d.name || d.source || '').toString().trim().toLowerCase();
        }).filter(Boolean));
        // 2. Get the leads module
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'leads' });
        if (!leadModule) {
            res.status(200).json({ campaigns: [] });
            return;
        }
        const leadQuery = {
            organizationId: orgId,
            moduleId: leadModule._id,
            $or: [
                { 'data.source': { $exists: true, $ne: '' } },
                { 'data.campaignName': { $exists: true, $ne: '' } },
                { 'data.campaign': { $exists: true, $ne: '' } },
                { 'data.campaign_name': { $exists: true, $ne: '' } }
            ]
        };
        // Filter by reporting hierarchy
        await hierarchy_1.HierarchyService.modifyRecordQuery(leadQuery, req.user, orgId);
        let leads = await CustomRecord_1.default.find(leadQuery).lean();
        // Fallback: If hierarchy query found 0, fetch all leads for org
        if (leads.length === 0) {
            leads = await CustomRecord_1.default.find({
                organizationId: orgId,
                moduleId: leadModule._id,
                $or: [
                    { 'data.source': { $exists: true, $ne: '' } },
                    { 'data.campaignName': { $exists: true, $ne: '' } },
                    { 'data.campaign': { $exists: true, $ne: '' } },
                    { 'data.campaign_name': { $exists: true, $ne: '' } }
                ]
            }).lean();
        }
        // Group leads by campaign name — only include actual campaigns!
        const campaignGroups = {};
        leads.forEach((lead) => {
            const d = lead.data || {};
            const rawSource = (d.campaignName ||
                d.campaign ||
                d.campaign_name ||
                d.source)?.toString().trim();
            if (rawSource) {
                const lower = rawSource.toLowerCase();
                const genericSources = ['website', 'referral', 'cold call', 'social media', 'google ads', 'facebook ads', 'walk-in', 'direct'];
                const isRegistered = registeredCampaignNames.size === 0 || registeredCampaignNames.has(lower);
                if (isRegistered && (registeredCampaignNames.has(lower) || !genericSources.includes(lower))) {
                    // Find canonical name from registered campaign or use raw
                    const canonical = campaignRecords.find(c => {
                        const cd = c.data || {};
                        return (cd.campaignName || cd.name || cd.source || '').toString().trim().toLowerCase() === lower;
                    });
                    const campName = canonical ? (canonical.data?.campaignName || canonical.data?.name || rawSource) : rawSource;
                    if (!campaignGroups[campName]) {
                        campaignGroups[campName] = [];
                    }
                    campaignGroups[campName].push(lead);
                }
            }
        });
        const result = Object.keys(campaignGroups)
            .map(campName => {
            const groupLeads = campaignGroups[campName];
            const totalAssigned = groupLeads.length;
            // Accurate calculation of dialed leads:
            const dialed = groupLeads.filter(l => {
                const d = l.data || {};
                const dialSt = (d.dialStatus || '').toString().trim().toLowerCase();
                const st = (d.status || '').toString().trim().toLowerCase();
                const hasDialStatus = dialSt && dialSt !== 'yet to call' && dialSt !== 'not called' && dialSt !== 'new';
                const hasDialedStatus = st && st !== 'new' && st !== 'yet to call' && st !== 'not called';
                const hasCalls = (d.callAttempts && Number(d.callAttempts) > 0) || !!d.dialedAt;
                return hasDialedStatus || (hasCalls && hasDialStatus);
            }).length;
            const yetToDial = Math.max(0, totalAssigned - dialed);
            const campRecord = campaignRecords.find(c => {
                const d = c.data || {};
                const name = (d.campaignName || d.name || d.source || '').toString().trim();
                return name.toLowerCase() === campName.toLowerCase();
            });
            const createdAt = campRecord?.createdAt || groupLeads[0]?.createdAt || new Date();
            return {
                campaignName: campName,
                totalAssigned,
                dialed,
                yetToDial,
                createdAt,
                dailyTarget: 200
            };
        });
        res.status(200).json({ campaigns: result });
    }
    catch (error) {
        console.error('Failed to get my campaigns:', error);
        res.status(500).json({ error: 'Failed to retrieve campaigns.' });
    }
});
// GET my campaign details (assigned leads under campaignName)
router.get('/campaigns/my-campaigns/details/:campaignName', async (req, res) => {
    try {
        const orgId = req.organizationId;
        const userId = req.user?.id;
        const { campaignName } = req.params;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized.' });
            return;
        }
        // Get the leads module
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'leads' });
        if (!leadModule) {
            res.status(404).json({ error: 'Leads module not found.' });
            return;
        }
        const decodedCampaignName = decodeURIComponent(campaignName).trim();
        const escName = decodedCampaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const campaignRegex = new RegExp('^\\s*' + escName + '\\s*$', 'i');
        const matchFilter = {
            $or: [
                { 'data.source': campaignRegex },
                { 'data.campaignName': campaignRegex },
                { 'data.campaign': campaignRegex },
                { 'data.campaign_name': campaignRegex }
            ]
        };
        const query = {
            organizationId: orgId,
            moduleId: leadModule._id,
            ...matchFilter
        };
        // Optimize payload with field projection for instant retrieval of 3000+ leads
        const LEAD_PROJECTION = '_id data.firstName data.lastName data.customerName data.customer data.company data.firmName data.firm_name data.phone data.mobile data.contactNumber data.name_contact_num data.city data.location data.dataCode data.data_code data.status data.dialStatus data.notes data.remarks data.caseDetails data.leadCategory data.lead_category data.loanType data.assignedTo data.callAttempts data.dialedAt data.source data.campaignName data.createdDate createdAt';
        let leads = await CustomRecord_1.default.find(query)
            .select(LEAD_PROJECTION)
            .sort({ createdAt: -1 })
            .lean();
        // Fallback: If hierarchy query returns 0, try org-wide lookup for this campaign
        if (leads.length === 0) {
            const fallbackQuery = {
                organizationId: orgId,
                moduleId: leadModule._id,
                ...matchFilter
            };
            leads = await CustomRecord_1.default.find(fallbackQuery)
                .select(LEAD_PROJECTION)
                .sort({ createdAt: -1 })
                .lean();
        }
        // Ultimate Fallback: Try across all modules in organization matching campaign name
        if (leads.length === 0) {
            leads = await CustomRecord_1.default.find({
                organizationId: orgId,
                ...matchFilter
            })
                .select(LEAD_PROJECTION)
                .sort({ createdAt: -1 })
                .lean();
        }
        res.status(200).json({ leads });
    }
    catch (error) {
        console.error('Failed to get my campaign details:', error);
        res.status(500).json({ error: 'Failed to retrieve campaign details.' });
    }
});
// Helper to resolve canonical synonyms across dashboard and lead statuses
function getStatusSynonyms(statusVal) {
    if (!statusVal || typeof statusVal !== 'string')
        return [];
    const clean = statusVal.trim();
    const upper = clean.toUpperCase();
    const noLeads = upper.replace(/\s+LEADS?$/i, '').trim();
    const withLeads = noLeads ? `${noLeads} LEADS` : upper;
    const synonyms = new Set([clean, upper, noLeads, withLeads]);
    // HOT
    if (upper.includes('HOT')) {
        synonyms.add('HOT');
        synonyms.add('HOT LEADS');
        synonyms.add('HOT LEAD');
        synonyms.add('Hot');
        synonyms.add('Hot Leads');
    }
    // WARM
    if (upper.includes('WARM')) {
        synonyms.add('WARM');
        synonyms.add('WARM LEADS');
        synonyms.add('WARM LEAD');
        synonyms.add('Warm');
        synonyms.add('Warm Leads');
    }
    // CEBIL / CEDIL
    if (upper.includes('CEBIL') || upper.includes('CEDIL')) {
        synonyms.add('CEBIL PENDING');
        synonyms.add('CEDIL PENDING');
        synonyms.add('CEBIL');
        synonyms.add('CEDIL');
        synonyms.add('Cebil Pending');
        synonyms.add('Cedil Pending');
    }
    // DOCUMENT
    if (upper.includes('DOCUMENT') || upper.includes('DOC PENDING')) {
        synonyms.add('DOCUMENT PENDING');
        synonyms.add('DOCUMENTS PENDING');
        synonyms.add('DOC PENDING');
        synonyms.add('Document Pending');
        synonyms.add('Documents Pending');
        synonyms.add('PROPOSAL');
    }
    // APPROVAL
    if (upper.includes('APPROVAL') || upper === 'NEGOTIATION') {
        synonyms.add('APPROVAL PENDING');
        synonyms.add('APPROVALS PENDING');
        synonyms.add('Approval Pending');
        synonyms.add('NEGOTIATION');
    }
    // APPROVED BUT NOT DISBUSE / APPROVED
    if (upper.includes('APPROVED') && !upper.includes('DISBU')) {
        synonyms.add('APPROVED BUT NOT DISBUSE');
        synonyms.add('APPROVED BUT NOT DISBURSED');
        synonyms.add('APPROVED');
        synonyms.add('Approved');
        synonyms.add('Approved But Not Disbuse');
        synonyms.add('Approved But Not Disbursed');
    }
    else if (upper.includes('APPROVED BUT NOT')) {
        synonyms.add('APPROVED BUT NOT DISBUSE');
        synonyms.add('APPROVED BUT NOT DISBURSED');
        synonyms.add('APPROVED');
        synonyms.add('Approved');
    }
    // DISBUSED / DISBURSED
    if ((upper.includes('DISBUSED') || upper.includes('DISBURSED')) && !upper.includes('NOT')) {
        synonyms.add('DISBUSED');
        synonyms.add('DISBURSED');
        synonyms.add('Disbused');
        synonyms.add('Disbursed');
    }
    // REJECTED
    if (upper.includes('REJECT')) {
        synonyms.add('REJECTED');
        synonyms.add('REJECT');
        synonyms.add('Rejected');
    }
    // FOLLOWUP - strictly pipeline stage, not campaign telecalling statuses
    if (upper.includes('FOLLOW')) {
        synonyms.add('FOLLOWUP');
        synonyms.add('FOLLOW UP');
        synonyms.add('FOLLOW-UP');
        synonyms.add('Followup');
        synonyms.add('Follow Up');
    }
    // DROPPED - strictly pipeline stage, not campaign telecalling statuses
    if (upper.includes('DROP')) {
        synonyms.add('DROPPED');
        synonyms.add('DROP');
        synonyms.add('Dropped');
    }
    // PENDING
    if (upper === 'PENDING' || upper.includes('INKWORLDWIDE') || upper.includes('INK WORLDWIDE')) {
        synonyms.add('PENDING');
        synonyms.add('Pending');
        synonyms.add('INKWORLDWIDE');
        synonyms.add('Ink Worldwide');
    }
    return Array.from(synonyms).filter(Boolean);
}
// Regex matching only the 11 official Lead Pipeline Stages (strictly excludes Campaign telecalling contacts)
exports.PIPELINE_LEAD_STATUS_REGEX = '^(HOT(\\s+LEADS?)?|WARM(\\s+LEADS?)?|CE[BD]IL(\\s+PENDING)?|DOC(UMENT)?S?(\\s+PENDING)?|PROPOSAL|APPROVALS?(\\s+PENDING)?|NEGOTIATION|APPROVED(\\s+BUT\\s+NOT\\s+DISBU(RS|S)E?D?)?|DISBU(RS|S)E?D?|REJECT(ED)?|FOLLOW[- ]?UP|DROP(PED)?|PENDING|INK\\s*WORLDWIDE)$';
// 1. LIST RECORDS FOR A DYNAMIC MODULE
router.get('/:apiPath', async (req, res) => {
    try {
        const { apiPath } = req.params;
        const defaultLimit = apiPath.toLowerCase() === 'leads' ? '10' : '50';
        const { search, page = '1', limit = defaultLimit, sort } = req.query;
        const moduleDef = await ModuleDefinition_1.default.findOne({
            organizationId: req.organizationId,
            apiPath: apiPath.toLowerCase()
        });
        if (!moduleDef) {
            res.status(404).json({ error: `Module path not found: ${apiPath}` });
            return;
        }
        // RBAC validation
        const { allowed, scope } = await authorizeModuleAction(req, res, moduleDef.name, 'read');
        if (!allowed) {
            res.status(403).json({ error: `Access Denied: Read permission absent for module ${moduleDef.name}` });
            return;
        }
        // Construct Query Filters
        const query = {
            organizationId: req.organizationId,
            moduleId: moduleDef._id
        };
        if (scope === 'own') {
            query.createdBy = req.user?.id;
        }
        // Differentiate Campaign Contacts vs Real Leads:
        // Raw campaign contacts (dial status 'Yet To Call', 'Not Connected', 'Wrong Number', etc.) belong strictly to Campaigns,
        // NOT to Leads Process. Only directly created leads and campaign contacts converted via Hot/Warm lead appear in Leads Process.
        if (apiPath.toLowerCase() === 'leads') {
            const realLeadFilter = {
                'data.status': { $regex: exports.PIPELINE_LEAD_STATUS_REGEX }
            };
            if (query.$and) {
                query.$and.push(realLeadFilter);
            }
            else {
                query.$and = [realLeadFilter];
            }
        }
        // Direct status, leadStatus, or followup query params support
        if (req.query.status && !req.query['data.status']) {
            req.query['data.status'] = req.query.status;
        }
        if (req.query.leadStatus && !req.query['data.leadStatus']) {
            req.query['data.leadStatus'] = req.query.leadStatus;
        }
        if (req.query.followup === 'today' || req.query['data.followup'] === 'today') {
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const endOfToday = new Date();
            endOfToday.setHours(23, 59, 59, 999);
            const timeFilter = {
                $or: [
                    { 'data.followUpDate': { $gte: startOfToday, $lte: endOfToday } },
                    { 'data.followUpDate': { $regex: '^' + startOfToday.toISOString().split('T')[0] } }
                ]
            };
            if (query.$and) {
                query.$and.push(timeFilter);
            }
            else {
                query.$and = [timeFilter];
            }
        }
        // Parse other fields for inline filters, e.g. ?data.status=HOT LEADS
        Object.keys(req.query).forEach((q) => {
            if (q.startsWith('data.')) {
                const val = req.query[q];
                if (typeof val === 'string' && val.trim()) {
                    const cleanVal = val.trim();
                    if (q === 'data.status' || q === 'data.leadStatus') {
                        const synonyms = getStatusSynonyms(cleanVal);
                        const escSynonyms = synonyms.map((s) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
                        const statusRegex = `^\\s*(${escSynonyms.join('|')})\\s*$`;
                        const statusFilter = {
                            $or: [
                                { 'data.status': { $regex: statusRegex } },
                                { 'data.leadStatus': { $regex: statusRegex } },
                                { 'data.pipelineStage': { $regex: statusRegex } }
                            ]
                        };
                        if (query.$and) {
                            query.$and.push(statusFilter);
                        }
                        else {
                            query.$and = [statusFilter];
                        }
                    }
                    else {
                        const escVal = cleanVal.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                        query[q] = { $regex: new RegExp(`^${escVal}$`, 'i') };
                    }
                }
                else {
                    query[q] = val;
                }
            }
        });
        // Global Search across text fields, lead number, created by, and common entity fields
        if (search && typeof search === 'string' && search.trim()) {
            const trimmedSearch = search.trim();
            const escSearch = trimmedSearch.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const searchRegex = { $regex: escSearch, $options: 'i' };
            // 1. Find matching users for createdBy / updatedBy search
            const matchedUsers = await User_1.default.find({
                organizationId: req.organizationId,
                $or: [
                    { firstName: searchRegex },
                    { lastName: searchRegex },
                    { name: searchRegex },
                    { email: searchRegex },
                    { userCode: searchRegex }
                ]
            }).select('_id');
            const matchedUserIds = matchedUsers.map((u) => u._id);
            const searchConditions = [
                // Match module dynamic fields
                ...moduleDef.fields
                    .filter((f) => ['text', 'email', 'phone', 'rich-text', 'url', 'select', 'number'].includes(f.type))
                    .map((f) => ({ [`data.${f.name}`]: searchRegex })),
                // Match standard lead name and number fields
                { 'data.name': searchRegex },
                { 'data.firstName': searchRegex },
                { 'data.lastName': searchRegex },
                { 'data.customerName': searchRegex },
                { 'data.leadName': searchRegex },
                { 'data.applicantName': searchRegex },
                { 'data.clientName': searchRegex },
                { 'data.leadNo': searchRegex },
                { 'data.leadNumber': searchRegex },
                { 'data.lead_no': searchRegex },
                { 'data.leadId': searchRegex },
                { 'data.leadCode': searchRegex },
                { 'data.firmName': searchRegex },
                { 'data.company': searchRegex },
                { 'data.companyName': searchRegex },
                { 'data.phone': searchRegex },
                { 'data.phoneNumber': searchRegex },
                { 'data.mobile': searchRegex },
                { 'data.mobileNumber': searchRegex },
                { 'data.email': searchRegex },
                { 'data.source': searchRegex },
                { 'data.campaign': searchRegex },
                { 'data.campaignName': searchRegex },
                { 'data.assignedTo': searchRegex }
            ];
            // Match createdBy / updatedBy users
            if (matchedUserIds.length > 0) {
                searchConditions.push({ createdBy: { $in: matchedUserIds } });
                searchConditions.push({ updatedBy: { $in: matchedUserIds } });
            }
            // If search query is a valid 24-character ID
            if (/^[0-9a-fA-F]{24}$/.test(trimmedSearch)) {
                searchConditions.push({ _id: trimmedSearch });
            }
            if (searchConditions.length > 0) {
                query.$or = searchConditions;
            }
        }
        // Apply Dynamic Reporting Manager Hierarchy filtering
        await hierarchy_1.HierarchyService.modifyRecordQuery(query, req.user, req.organizationId);
        // Pagination
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skipNum = (pageNum - 1) * limitNum;
        // Sorting
        let sortOption = { createdAt: -1 };
        if (sort && typeof sort === 'string') {
            const isDesc = sort.startsWith('-');
            const sortField = isDesc ? sort.substring(1) : sort;
            sortOption = { [sortField.startsWith('data.') ? sortField : `data.${sortField}`]: isDesc ? -1 : 1 };
        }
        // Parallel execution of record query and count for lightning fast loading
        const [records, total] = await Promise.all([
            CustomRecord_1.default.find(query)
                .populate('createdBy', 'firstName lastName name email')
                .populate('updatedBy', 'firstName lastName name email')
                .sort(sortOption)
                .skip(skipNum)
                .limit(limitNum),
            CustomRecord_1.default.countDocuments(query)
        ]);
        // Resolve any User ObjectIds/hashes in data.assignedTo, data.assignedBy, data.psm to real names
        const userIdsToFetch = new Set();
        records.forEach((r) => {
            if (r.data?.assignedTo && /^[0-9a-fA-F]{24}$/.test(String(r.data.assignedTo))) {
                userIdsToFetch.add(String(r.data.assignedTo));
            }
            if (r.data?.assignedBy && /^[0-9a-fA-F]{24}$/.test(String(r.data.assignedBy))) {
                userIdsToFetch.add(String(r.data.assignedBy));
            }
            if (r.data?.psm && /^[0-9a-fA-F]{24}$/.test(String(r.data.psm))) {
                userIdsToFetch.add(String(r.data.psm));
            }
        });
        if (userIdsToFetch.size > 0) {
            const userDocs = await User_1.default.find({ _id: { $in: Array.from(userIdsToFetch) } }).select('firstName lastName name email');
            const userMap = new Map(userDocs.map((u) => [u._id.toString(), `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email]));
            records.forEach((r) => {
                if (r.data) {
                    if (r.data.assignedTo && userMap.has(String(r.data.assignedTo))) {
                        r.data.assignedToName = userMap.get(String(r.data.assignedTo));
                        r.data.assignedTo = userMap.get(String(r.data.assignedTo));
                    }
                    if (r.data.assignedBy && userMap.has(String(r.data.assignedBy))) {
                        r.data.assignedByName = userMap.get(String(r.data.assignedBy));
                        r.data.assignedBy = userMap.get(String(r.data.assignedBy));
                    }
                    if (r.data.psm && userMap.has(String(r.data.psm))) {
                        r.data.psmName = userMap.get(String(r.data.psm));
                        r.data.psm = userMap.get(String(r.data.psm));
                    }
                }
            });
        }
        res.status(200).json({
            records,
            pagination: {
                total,
                totalRecords: total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.max(1, Math.ceil(total / limitNum))
            }
        });
    }
    catch (error) {
        console.error('List Records Error:', error);
        res.status(500).json({ error: 'Failed to retrieve records.' });
    }
});
// 2. CREATE A RECORD
router.post('/:apiPath', async (req, res) => {
    try {
        const { apiPath } = req.params;
        const recordData = req.body.data ? req.body.data : req.body;
        const moduleDef = await ModuleDefinition_1.default.findOne({
            organizationId: req.organizationId,
            apiPath: apiPath.toLowerCase()
        });
        if (!moduleDef) {
            res.status(404).json({ error: `Module definition not found: ${apiPath}` });
            return;
        }
        // Check RBAC permissions
        const { allowed } = await authorizeModuleAction(req, res, moduleDef.name, 'create');
        if (!allowed) {
            res.status(403).json({ error: `Access Denied: Create permission absent for module ${moduleDef.name}` });
            return;
        }
        // Populate default values for missing fields
        moduleDef.fields.forEach((field) => {
            if (field.defaultValue && (recordData[field.name] === undefined || recordData[field.name] === null || recordData[field.name] === '')) {
                recordData[field.name] = field.defaultValue;
            }
        });
        // Validate inputs
        const validationErrors = validateFields(moduleDef.fields, recordData);
        if (validationErrors.length > 0) {
            res.status(400).json({ error: 'Validation failed', details: validationErrors });
            return;
        }
        // Unique field validation
        for (const field of moduleDef.fields) {
            if (field.unique && recordData[field.name]) {
                const duplicate = await CustomRecord_1.default.findOne({
                    organizationId: req.organizationId,
                    moduleId: moduleDef._id,
                    [`data.${field.name}`]: recordData[field.name]
                });
                if (duplicate) {
                    res.status(400).json({ error: `Duplicate error: Value for '${field.label}' must be unique.` });
                    return;
                }
            }
        }
        // Evaluate Calculated / Formula fields
        moduleDef.fields.forEach((field) => {
            if (field.type === 'formula' && field.formulaExpression) {
                const computed = formulaEvaluator_1.FormulaEvaluator.evaluate(field.formulaExpression, recordData);
                if (computed !== null) {
                    recordData[field.name] = computed;
                }
            }
        });
        const creatorId = String(req.user?.id);
        const newRecord = await CustomRecord_1.default.create({
            organizationId: req.organizationId,
            moduleId: moduleDef._id,
            data: recordData,
            createdBy: creatorId,
            updatedBy: creatorId
        });
        // Timeline Logging (Activity)
        await Activity_1.default.create({
            organizationId: req.organizationId,
            recordId: newRecord._id,
            userId: creatorId,
            type: 'create',
            details: {}
        });
        // System Auditing
        await AuditLog_1.default.create({
            organizationId: req.organizationId,
            userId: creatorId,
            action: 'record.create',
            resource: moduleDef.name,
            resourceId: String(newRecord._id),
            newValue: recordData
        });
        // Generate Notification if assignedTo is set
        if (recordData.assignedTo) {
            const name = `${recordData.firstName || ''} ${recordData.lastName || ''}`.trim() || moduleDef.singularLabel || 'Record';
            await (0, notificationHelper_1.createNotification)({
                organizationId: req.organizationId,
                recipient: recordData.assignedTo,
                title: `${moduleDef.singularLabel || 'Lead'} Assigned`,
                message: `${moduleDef.singularLabel || 'Lead'} '${name}' has been assigned to you.`,
                type: 'info',
                link: `/modules/${apiPath.toLowerCase()}/${newRecord._id}`
            });
        }
        // Execute Workflows
        workflowEngine_1.WorkflowEngine.trigger(req.organizationId, moduleDef._id, 'create', newRecord);
        res.status(201).json(newRecord);
    }
    catch (error) {
        console.error('Create Record Error:', error);
        res.status(500).json({ error: 'Failed to create record.' });
    }
});
// 3. READ SINGLE RECORD
router.get('/:apiPath/:id', async (req, res) => {
    try {
        const { apiPath, id } = req.params;
        const moduleDef = await ModuleDefinition_1.default.findOne({
            organizationId: req.organizationId,
            apiPath: apiPath.toLowerCase()
        });
        if (!moduleDef) {
            res.status(404).json({ error: 'Module not found.' });
            return;
        }
        const { allowed, scope } = await authorizeModuleAction(req, res, moduleDef.name, 'read');
        if (!allowed) {
            res.status(403).json({ error: 'Access denied.' });
            return;
        }
        const query = {
            _id: id,
            organizationId: req.organizationId
        };
        if (scope === 'own') {
            query.createdBy = req.user?.id;
        }
        // Apply Dynamic Reporting Manager Hierarchy filtering
        await hierarchy_1.HierarchyService.modifyRecordQuery(query, req.user, req.organizationId);
        const record = await CustomRecord_1.default.findOne(query)
            .populate('createdBy', 'firstName lastName name email')
            .populate('updatedBy', 'firstName lastName name email');
        if (!record) {
            res.status(404).json({ error: 'Record not found.' });
            return;
        }
        if (record.data) {
            const ids = [record.data.assignedTo, record.data.assignedBy, record.data.psm]
                .filter(id => id && /^[0-9a-fA-F]{24}$/.test(String(id)));
            if (ids.length > 0) {
                const users = await User_1.default.find({ _id: { $in: ids } }).select('firstName lastName name email');
                const userMap = new Map(users.map((u) => [u._id.toString(), `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email]));
                if (record.data.assignedTo && userMap.has(String(record.data.assignedTo))) {
                    record.data.assignedToName = userMap.get(String(record.data.assignedTo));
                    record.data.assignedTo = userMap.get(String(record.data.assignedTo));
                }
                if (record.data.assignedBy && userMap.has(String(record.data.assignedBy))) {
                    record.data.assignedByName = userMap.get(String(record.data.assignedBy));
                    record.data.assignedBy = userMap.get(String(record.data.assignedBy));
                }
                if (record.data.psm && userMap.has(String(record.data.psm))) {
                    record.data.psmName = userMap.get(String(record.data.psm));
                    record.data.psm = userMap.get(String(record.data.psm));
                }
            }
        }
        res.status(200).json(record);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to retrieve record.' });
    }
});
// 4. UPDATE A RECORD
router.put('/:apiPath/:id', async (req, res) => {
    try {
        const { apiPath, id } = req.params;
        const updateData = req.body.data ? req.body.data : req.body;
        const moduleDef = await ModuleDefinition_1.default.findOne({
            organizationId: req.organizationId,
            apiPath: apiPath.toLowerCase()
        });
        if (!moduleDef) {
            res.status(404).json({ error: 'Module not found.' });
            return;
        }
        // Check RBAC permissions
        const { allowed, scope } = await authorizeModuleAction(req, res, moduleDef.name, 'update');
        if (!allowed) {
            res.status(403).json({ error: `Access Denied: Update permission absent for module ${moduleDef.name}` });
            return;
        }
        const recordQuery = {
            _id: id,
            organizationId: req.organizationId
        };
        if (scope === 'own') {
            recordQuery.createdBy = req.user?.id;
        }
        // Apply Dynamic Reporting Manager Hierarchy filtering
        await hierarchy_1.HierarchyService.modifyRecordQuery(recordQuery, req.user, req.organizationId);
        const record = await CustomRecord_1.default.findOne(recordQuery);
        if (!record) {
            res.status(404).json({ error: 'Record not found.' });
            return;
        }
        const oldValues = record.data instanceof Map ? Object.fromEntries(record.data) : record.data;
        // Validate inputs against the merged data
        const mergedData = {
            ...oldValues,
            ...updateData
        };
        const validationErrors = validateFields(moduleDef.fields, mergedData, oldValues);
        if (validationErrors.length > 0) {
            res.status(400).json({ error: 'Validation failed', details: validationErrors });
            return;
        }
        // Unique field validation (excluding self)
        for (const field of moduleDef.fields) {
            if (field.unique && updateData[field.name]) {
                const duplicate = await CustomRecord_1.default.findOne({
                    organizationId: req.organizationId,
                    moduleId: moduleDef._id,
                    _id: { $ne: record._id },
                    [`data.${field.name}`]: updateData[field.name]
                });
                if (duplicate) {
                    res.status(400).json({ error: `Value for '${field.label}' must be unique.` });
                    return;
                }
            }
        }
        // Capture changed fields
        const changedFields = [];
        Object.keys(updateData).forEach((key) => {
            if (String(oldValues[key]) !== String(updateData[key])) {
                changedFields.push(key);
            }
        });
        // Evaluate Calculated / Formula fields based on updated data values
        moduleDef.fields.forEach((field) => {
            if (field.type === 'formula' && field.formulaExpression) {
                const computed = formulaEvaluator_1.FormulaEvaluator.evaluate(field.formulaExpression, {
                    ...oldValues,
                    ...updateData
                });
                if (computed !== null) {
                    updateData[field.name] = computed;
                }
            }
        });
        // Perform Update
        const updaterId = String(req.user?.id);
        record.data = {
            ...oldValues,
            ...updateData
        };
        record.updatedBy = updaterId;
        await record.save();
        // Log Activity logs for status updates or assignments
        for (const fieldName of changedFields) {
            await Activity_1.default.create({
                organizationId: req.organizationId,
                recordId: record._id,
                userId: updaterId,
                type: fieldName === 'status' ? 'status_change' : 'edit',
                details: {
                    fieldName,
                    oldValue: oldValues[fieldName],
                    newValue: updateData[fieldName]
                }
            });
        }
        // System Audit Log
        await AuditLog_1.default.create({
            organizationId: req.organizationId,
            userId: updaterId,
            action: 'record.update',
            resource: moduleDef.name,
            resourceId: String(record._id),
            oldValue: oldValues,
            newValue: updateData
        });
        // Generate Notifications for assignedTo or status changes
        const recName = `${record.data?.firstName || ''} ${record.data?.lastName || ''}`.trim() || moduleDef.singularLabel || 'Record';
        const userObj = req.user;
        const updaterName = userObj?.firstName ? `${userObj.firstName} ${userObj.lastName || ''}`.trim() : (userObj?.email || 'System');
        if (changedFields.includes('assignedTo') && updateData.assignedTo) {
            await (0, notificationHelper_1.createNotification)({
                organizationId: req.organizationId,
                recipient: updateData.assignedTo,
                title: `${moduleDef.singularLabel || 'Lead'} Assigned`,
                message: `${moduleDef.singularLabel || 'Lead'} '${recName}' was assigned to you by ${updaterName}.`,
                type: 'info',
                link: `/modules/${apiPath.toLowerCase()}/${record._id}`
            });
        }
        if (changedFields.includes('status') && record.data?.assignedTo) {
            await (0, notificationHelper_1.createNotification)({
                organizationId: req.organizationId,
                recipient: record.data.assignedTo,
                title: `${moduleDef.singularLabel || 'Lead'} Status Updated`,
                message: `Status of '${recName}' was updated to '${updateData.status}' by ${updaterName}.`,
                type: 'info',
                link: `/modules/${apiPath.toLowerCase()}/${record._id}`
            });
        }
        // Execute Workflows
        workflowEngine_1.WorkflowEngine.trigger(req.organizationId, moduleDef._id, 'update', record, changedFields);
        res.status(200).json(record);
    }
    catch (error) {
        console.error('Update Record Error:', error);
        res.status(500).json({ error: 'Failed to update record.' });
    }
});
// 5. DELETE A RECORD
router.delete('/:apiPath/:id', async (req, res) => {
    try {
        const { apiPath, id } = req.params;
        const moduleDef = await ModuleDefinition_1.default.findOne({
            organizationId: req.organizationId,
            apiPath: apiPath.toLowerCase()
        });
        if (!moduleDef) {
            res.status(404).json({ error: 'Module not found.' });
            return;
        }
        const { allowed, scope } = await authorizeModuleAction(req, res, moduleDef.name, 'delete');
        if (!allowed) {
            res.status(403).json({ error: 'Access denied.' });
            return;
        }
        const query = {
            _id: id,
            organizationId: req.organizationId
        };
        if (scope === 'own') {
            query.createdBy = req.user?.id;
        }
        // Apply Dynamic Reporting Manager Hierarchy filtering
        await hierarchy_1.HierarchyService.modifyRecordQuery(query, req.user, req.organizationId);
        const record = await CustomRecord_1.default.findOne(query);
        if (!record) {
            res.status(404).json({ error: 'Record not found.' });
            return;
        }
        await CustomRecord_1.default.findByIdAndDelete(record._id);
        // Audit logs
        await AuditLog_1.default.create({
            organizationId: req.organizationId,
            userId: String(req.user?.id),
            action: 'record.delete',
            resource: moduleDef.name,
            resourceId: String(record._id),
            oldValue: record.data
        });
        // Execute delete workflow triggers
        workflowEngine_1.WorkflowEngine.trigger(req.organizationId, moduleDef._id, 'delete', record);
        res.status(200).json({ message: 'Record deleted successfully.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete record.' });
    }
});
// Transfer leads between agents
router.post('/transfer/leads', async (req, res) => {
    try {
        const { fromAgentId, fromAgentName, toAgentId, toAgentName } = req.body;
        if (!fromAgentId || !toAgentId || !fromAgentName || !toAgentName) {
            res.status(400).json({ error: 'fromAgentId, fromAgentName, toAgentId, and toAgentName are required.' });
            return;
        }
        const moduleDef = await ModuleDefinition_1.default.findOne({
            organizationId: req.organizationId,
            apiPath: 'leads'
        });
        if (!moduleDef) {
            res.status(404).json({ error: 'Leads module not found.' });
            return;
        }
        // Update all leads matching the source agent's ID or name
        const result = await CustomRecord_1.default.updateMany({
            organizationId: req.organizationId,
            moduleId: moduleDef._id,
            $or: [
                { 'data.assignedTo': fromAgentId },
                { 'data.assignedTo': fromAgentName }
            ]
        }, {
            $set: { 'data.assignedTo': toAgentName } // Store as full name for display compatibility
        });
        // Create Audit Log
        await AuditLog_1.default.create({
            organizationId: req.organizationId,
            userId: String(req.user?.id),
            action: 'leads.transfer',
            resource: 'leads',
            details: {
                fromAgentId,
                fromAgentName,
                toAgentId,
                toAgentName,
                modifiedCount: result.modifiedCount
            }
        });
        // Generate Notification for target agent
        if (result.modifiedCount > 0) {
            await (0, notificationHelper_1.createNotification)({
                organizationId: req.organizationId,
                recipient: toAgentId || toAgentName,
                title: 'Leads Transferred to You',
                message: `${result.modifiedCount} lead(s) were transferred to you from ${fromAgentName}.`,
                type: 'info',
                link: '/modules/leads'
            });
        }
        res.status(200).json({ message: 'Leads transferred successfully.', modifiedCount: result.modifiedCount });
    }
    catch (error) {
        console.error('Failed to transfer leads:', error);
        res.status(500).json({ error: 'Failed to transfer leads.' });
    }
});
// GET record activity history
router.get('/:apiPath/:id/activities', async (req, res) => {
    try {
        const recordQuery = {
            _id: req.params.id,
            organizationId: req.organizationId
        };
        await hierarchy_1.HierarchyService.modifyRecordQuery(recordQuery, req.user, req.organizationId);
        const record = await CustomRecord_1.default.findOne(recordQuery);
        if (!record) {
            res.status(403).json({ error: 'Access denied.' });
            return;
        }
        const activities = await Activity_1.default.find({
            organizationId: req.organizationId,
            recordId: req.params.id
        })
            .populate('userId', 'firstName lastName email')
            .sort({ createdAt: -1 });
        res.status(200).json(activities);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to retrieve record activities.' });
    }
});
exports.default = router;
