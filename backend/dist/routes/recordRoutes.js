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
const Organization_1 = __importDefault(require("../models/Organization"));
const Activity_1 = __importDefault(require("../models/Activity"));
const AuditLog_1 = __importDefault(require("../models/AuditLog"));
const Status_1 = __importDefault(require("../models/Status"));
const leadStatusHelper_1 = require("../utils/leadStatusHelper");
const formulaEvaluator_1 = require("../services/formulaEvaluator");
const workflowEngine_1 = require("../services/workflowEngine");
const notificationHelper_1 = require("../utils/notificationHelper");
const authMiddleware_1 = require("../middleware/authMiddleware");
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const hierarchy_1 = require("../utils/hierarchy");
const cache_1 = require("../utils/cache");
const postgres_1 = require("../config/postgres");
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
        // Main Admin & Super Admin bypass
        if ((role.name === 'Main Admin' || role.name === 'Super Admin') && (role.isSystem || role.name === 'Main Admin')) {
            return { allowed: true, scope: 'all' };
        }
        // Allow reading settings/metadata modules (Departments, Bank Masters, Products, etc.)
        const settingsModules = ['departments', 'department', 'bankmasters', 'bankmaster', 'bankingpartners', 'bankingpartner', 'products', 'product'];
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
        const targetCampaign = (req.query.campaign || req.query.campaignName || '').toString().trim().toLowerCase();
        const cacheKey = `campaigns:alloc-stats:${orgId}:${targetCampaign || '__all__'}`;
        const cached = cache_1.serverCache.get(cacheKey);
        if (cached) {
            res.setHeader('X-Cache', 'HIT');
            res.status(200).json(cached);
            return;
        }
        // Find Lead Module Definition
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'leads' });
        if (!leadModule) {
            cache_1.serverCache.set(cacheKey, { stats: {}, dialedStats: {}, campaignAllocatedStats: {}, campaignDialedStats: {}, campaignAgentStats: {} }, 60);
            res.status(200).json({ stats: {}, dialedStats: {}, campaignAllocatedStats: {}, campaignDialedStats: {}, campaignAgentStats: {} });
            return;
        }
        const moduleId = leadModule._id || leadModule.id;
        // Fast Single-Pass PostgreSQL Direct Query (<25ms)
        try {
            const statsSql = `
        SELECT 
          LOWER(COALESCE(NULLIF(data->>'campaignName', ''), NULLIF(data->>'campaign', ''), NULLIF(data->>'source', ''), NULLIF(data->>'campaign_name', ''))) as camp_name,
          COALESCE(NULLIF(data->>'assignedTo', ''), '') as assigned_to,
          COUNT(*)::int as total_allocated,
          COUNT(CASE WHEN 
            (data->>'dialedAt' IS NOT NULL AND data->>'dialedAt' != '') OR 
            (data->>'callAttempts' IS NOT NULL AND (data->>'callAttempts')::int > 0) OR
            (LOWER(COALESCE(data->>'dialStatus', '')) NOT IN ('', 'yet to call', 'not called', 'new')) OR
            (LOWER(COALESCE(data->>'status', '')) NOT IN ('', 'yet to call', 'not called', 'new'))
          THEN 1 END)::int as dialed
        FROM custom_records
        WHERE organization_id = $1 AND module_id = $2
        GROUP BY 1, 2
      `;
            const rows = await (0, postgres_1.queryPg)(statsSql, [orgId, moduleId]);
            const campaignAllocatedStats = {};
            const campaignDialedStats = {};
            const campaignAgentStats = {};
            const statsMap = {};
            const dialedMap = {};
            const genericSources = new Set(['website', 'referral', 'cold call', 'social media', 'google ads', 'facebook ads', 'walk-in', 'direct']);
            rows.forEach((r) => {
                const camp = (r.camp_name || '').trim().toLowerCase();
                const agent = (r.assigned_to || '').trim();
                const alloc = parseInt(r.total_allocated, 10) || 0;
                const d = parseInt(r.dialed, 10) || 0;
                if (camp && !genericSources.has(camp)) {
                    campaignAllocatedStats[camp] = (campaignAllocatedStats[camp] || 0) + alloc;
                    campaignDialedStats[camp] = (campaignDialedStats[camp] || 0) + d;
                    if (agent) {
                        if (!campaignAgentStats[camp])
                            campaignAgentStats[camp] = {};
                        campaignAgentStats[camp][agent] = (campaignAgentStats[camp][agent] || 0) + alloc;
                    }
                }
                if (agent) {
                    statsMap[agent] = (statsMap[agent] || 0) + alloc;
                    dialedMap[agent] = (dialedMap[agent] || 0) + d;
                }
            });
            const effectiveStatsMap = targetCampaign
                ? (campaignAgentStats[targetCampaign] || {})
                : statsMap;
            const payload = {
                stats: effectiveStatsMap,
                globalStats: statsMap,
                dialedStats: dialedMap,
                campaignAllocatedStats,
                campaignDialedStats,
                campaignAgentStats
            };
            cache_1.serverCache.set(cacheKey, payload, 30);
            res.setHeader('X-Cache', 'MISS');
            res.status(200).json(payload);
            return;
        }
        catch (pgErr) {
            console.warn('[allocation-stats] Fast PG aggregation failed, falling back:', pgErr);
        }
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
            }).select('_id data.campaignName data.name data.source').lean();
        }
        const registeredCampaignNames = new Set(campaignRecords.map((c) => {
            const d = c.data || {};
            return (d.campaignName || d.name || d.source || '').toString().trim().toLowerCase();
        }).filter(Boolean));
        const LEAD_CAMPAIGN_PROJECTION = '_id data.assignedTo data.source data.campaignName data.campaign data.campaign_name data.dialStatus data.status data.callAttempts data.dialedAt';
        const allLeads = await CustomRecord_1.default.find({
            organizationId: orgId,
            moduleId: leadModule._id,
            $or: [
                { 'data.source': { $exists: true, $ne: '' } },
                { 'data.campaignName': { $exists: true, $ne: '' } },
                { 'data.campaign': { $exists: true, $ne: '' } },
                { 'data.campaign_name': { $exists: true, $ne: '' } }
            ]
        }).select(LEAD_CAMPAIGN_PROJECTION).lean();
        const campaignAllocatedStats = {};
        const campaignDialedStats = {};
        const campaignAgentStats = {};
        allLeads.forEach((lead) => {
            const d = lead.data || {};
            const campName = (d.campaignName ||
                d.campaign ||
                d.campaign_name ||
                d.source)?.toString().trim();
            const assigned = (d.assignedTo || '').toString().trim();
            if (campName) {
                const lower = campName.toLowerCase();
                const genericSources = ['website', 'referral', 'cold call', 'social media', 'google ads', 'facebook ads', 'walk-in', 'direct'];
                const isRegistered = registeredCampaignNames.size === 0 || registeredCampaignNames.has(lower);
                if (isRegistered && (registeredCampaignNames.has(lower) || !genericSources.includes(lower))) {
                    campaignAllocatedStats[lower] = (campaignAllocatedStats[lower] || 0) + 1;
                    if (assigned) {
                        if (!campaignAgentStats[lower]) {
                            campaignAgentStats[lower] = {};
                        }
                        campaignAgentStats[lower][assigned] = (campaignAgentStats[lower][assigned] || 0) + 1;
                    }
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
        // If a specific campaign was queried, stats reflects ONLY that specific campaign's agent allocations!
        const effectiveStatsMap = targetCampaign
            ? (campaignAgentStats[targetCampaign] || {})
            : statsMap;
        const payload = {
            stats: effectiveStatsMap,
            globalStats: statsMap,
            dialedStats: dialedMap,
            campaignAllocatedStats,
            campaignDialedStats,
            campaignAgentStats
        };
        cache_1.serverCache.set(cacheKey, payload, 30);
        res.setHeader('X-Cache', 'MISS');
        res.status(200).json(payload);
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
        cache_1.CacheInvalidators.invalidateDashboard(orgId);
        cache_1.CacheInvalidators.invalidateCampaigns(orgId);
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
        cache_1.CacheInvalidators.invalidateDashboard(orgId);
        cache_1.CacheInvalidators.invalidateCampaigns(orgId);
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
        const { campaignName, agentNames, leads, startIndex = 0 } = req.body;
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
        const globalOffset = Number(startIndex || 0);
        leads.forEach((lead, idx) => {
            // Balanced round-robin with offset
            const assignedAgent = cleanAgents[(globalOffset + idx) % numAgents];
            agentCounts[assignedAgent] = (agentCounts[assignedAgent] || 0) + 1;
            // Parse names — robustly support all possible Excel/CSV column naming variations
            let extractedName = '';
            for (const [k, v] of Object.entries(lead)) {
                const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanK.includes('company') || cleanK.includes('firm') || cleanK.includes('bank') || cleanK.includes('psm') || cleanK.includes('campaign') || cleanK.includes('source') || cleanK.includes('assignedto') || cleanK.includes('agent')) {
                    continue;
                }
                if (cleanK.includes('customer') ||
                    cleanK.includes('client') ||
                    cleanK.includes('leadname') ||
                    cleanK.includes('applicant') ||
                    cleanK.includes('borrower') ||
                    cleanK.includes('party') ||
                    cleanK.includes('contactperson') ||
                    cleanK.includes('custname') ||
                    cleanK === 'name' ||
                    cleanK === 'fullname' ||
                    cleanK === 'firstname' ||
                    cleanK === 'first' ||
                    cleanK === 'lead') {
                    if (v !== undefined && v !== null && String(v).trim() !== '' && !['N/A', 'UNNAMED', 'UNDEFINED', 'NULL'].includes(String(v).trim().toUpperCase())) {
                        extractedName = String(v).trim();
                        break;
                    }
                }
            }
            if (!extractedName) {
                extractedName = String(lead.firstName ||
                    lead.customerName ||
                    lead.customer ||
                    lead.name ||
                    lead.leadName ||
                    lead.fullName ||
                    '').trim();
            }
            // Do NOT default to "Unnamed"! If empty or "Unnamed", leave as blank ""
            if (extractedName.toUpperCase() === 'UNNAMED' || extractedName.toUpperCase() === 'N/A') {
                extractedName = '';
            }
            let fName = extractedName;
            let lName = lead.lastName || '';
            if (!lName && fName && fName.includes(' ')) {
                const parts = fName.split(' ');
                fName = parts[0];
                lName = parts.slice(1).join(' ');
            }
            // Extract dataCode from any possible column naming variation in Excel
            let rawDataCode = '';
            for (const [k, v] of Object.entries(lead)) {
                const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanK.includes('datacode') ||
                    cleanK.includes('leadcode') ||
                    cleanK.includes('customercode') ||
                    cleanK.includes('datano') ||
                    cleanK === 'code' ||
                    cleanK === 'dcode') {
                    if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim().toUpperCase() !== 'N/A') {
                        rawDataCode = String(v).trim();
                        break;
                    }
                }
            }
            if (!rawDataCode) {
                rawDataCode = (lead.dataCode ||
                    lead.data_code ||
                    lead['Data Code'] ||
                    lead['data code'] ||
                    lead['DATA CODE'] ||
                    lead.datacode ||
                    lead.DataCode ||
                    lead.DATA_CODE ||
                    lead.leadCode ||
                    lead.lead_code ||
                    lead.code ||
                    '')?.toString().trim();
            }
            const finalDataCode = rawDataCode || '';
            // Universal phone / mobile extractor from any possible column name in Excel
            let phoneVal = '';
            for (const [k, v] of Object.entries(lead)) {
                const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanK.includes('psm') || cleanK.includes('datacode') || cleanK.includes('leadno') || cleanK.includes('slno')) {
                    continue;
                }
                if (cleanK.includes('phone') ||
                    cleanK.includes('mobile') ||
                    cleanK.includes('contact') ||
                    cleanK.includes('cell') ||
                    cleanK.includes('mob') ||
                    cleanK.includes('tel') ||
                    cleanK.includes('calling') ||
                    cleanK.includes('dial') ||
                    cleanK === 'number' ||
                    cleanK === 'no') {
                    if (v !== undefined && v !== null) {
                        let strV = String(v).trim().replace(/\.0+$/, '');
                        if (strV !== '' && !['N/A', 'UNDEFINED', 'NULL'].includes(strV.toUpperCase())) {
                            phoneVal = strV;
                            break;
                        }
                    }
                }
            }
            if (!phoneVal) {
                // Fallback: check if any value looks like a 10-12 digit phone number
                for (const [k, v] of Object.entries(lead)) {
                    const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (cleanK.includes('sl') || cleanK.includes('id') || cleanK.includes('code') || cleanK.includes('amount') || cleanK.includes('budget'))
                        continue;
                    if (v !== undefined && v !== null) {
                        const numStr = String(v).trim().replace(/[^0-9]/g, '');
                        if (numStr.length === 10 || (numStr.length === 12 && numStr.startsWith('91'))) {
                            phoneVal = String(v).trim().replace(/\.0+$/, '');
                            break;
                        }
                    }
                }
            }
            if (!phoneVal) {
                phoneVal = String(lead.phone || lead.mobile || lead.contactNumber || lead.name_contact_num || lead.contact_num || lead.contact || lead.mobileNo || '').trim().replace(/\.0+$/, '');
            }
            // Universal location / city / place extractor from Excel
            let locationVal = '';
            for (const [k, v] of Object.entries(lead)) {
                const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanK.includes('location') ||
                    cleanK.includes('city') ||
                    cleanK.includes('place') ||
                    cleanK.includes('area') ||
                    cleanK.includes('district') ||
                    cleanK.includes('branch') ||
                    cleanK.includes('address') ||
                    cleanK.includes('state') ||
                    cleanK.includes('town') ||
                    cleanK.includes('zone') ||
                    cleanK.includes('region') ||
                    cleanK.includes('territory')) {
                    if (v !== undefined && v !== null && String(v).trim() !== '' && !['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(String(v).trim().toUpperCase())) {
                        locationVal = String(v).trim();
                        break;
                    }
                }
            }
            if (!locationVal) {
                locationVal = (lead.city || lead.location || lead.Location || lead.LOCATION || lead.place || lead.address || '')?.toString().trim();
            }
            // Universal firm / company extractor from Excel
            let firmVal = '';
            for (const [k, v] of Object.entries(lead)) {
                const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanK.includes('company') ||
                    cleanK.includes('firm') ||
                    cleanK.includes('firmname') ||
                    cleanK.includes('companyname') ||
                    cleanK.includes('organization') ||
                    cleanK.includes('employer') ||
                    cleanK.includes('business')) {
                    if (v !== undefined && v !== null && String(v).trim() !== '' && !['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(String(v).trim().toUpperCase())) {
                        firmVal = String(v).trim();
                        break;
                    }
                }
            }
            if (!firmVal) {
                firmVal = (lead.company || lead.firm_name || lead.firmName || lead.firm || '')?.toString().trim();
            }
            // Extract loanType / product separately from Excel
            let rawLoanType = '';
            for (const [k, v] of Object.entries(lead)) {
                const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanK.includes('loantype') ||
                    cleanK.includes('product') ||
                    cleanK.includes('producttype') ||
                    cleanK.includes('facility') ||
                    cleanK.includes('scheme')) {
                    if (v !== undefined && v !== null && String(v).trim() !== '' && !['N/A', 'UNDEFINED', 'NULL', 'PERSONAL LOAN', 'PERSONAL DETAILS'].includes(String(v).trim().toUpperCase())) {
                        rawLoanType = String(v).trim();
                        break;
                    }
                }
            }
            if (!rawLoanType) {
                rawLoanType = (lead.loanType || lead.product || lead['Loan Type'] || '')?.toString().trim();
            }
            // Lead category strictly what is in Excel, never defaulted
            let rawCategory = '';
            for (const [k, v] of Object.entries(lead)) {
                const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanK.includes('leadcat') ||
                    cleanK.includes('category') ||
                    cleanK.includes('leadtype') ||
                    cleanK.includes('cattype')) {
                    if (v !== undefined && v !== null && String(v).trim() !== '' && !['N/A', 'UNDEFINED', 'NULL', 'PERSONAL LOAN'].includes(String(v).trim().toUpperCase())) {
                        rawCategory = String(v).trim();
                        break;
                    }
                }
            }
            if (!rawCategory) {
                rawCategory = (lead.leadCategory || lead.lead_category || lead['Lead Category'] || lead.category || '')?.toString().trim();
            }
            // Bank partner extractor from Excel
            let bankPartnerVal = '';
            for (const [k, v] of Object.entries(lead)) {
                const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanK === 'bank' ||
                    cleanK === 'bankpartner' ||
                    cleanK === 'bankingpartner' ||
                    cleanK === 'bankname') {
                    if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim().toUpperCase() !== 'N/A') {
                        bankPartnerVal = String(v).trim();
                        break;
                    }
                }
            }
            if (!bankPartnerVal) {
                bankPartnerVal = (lead.bankPartner || lead.bank || lead.bankName || '')?.toString().trim();
            }
            // Case details extractor from Excel
            let caseDetailsVal = '';
            for (const [k, v] of Object.entries(lead)) {
                const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanK === 'casedetails' || cleanK === 'casestatus' || cleanK === 'case') {
                    if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim().toUpperCase() !== 'N/A') {
                        caseDetailsVal = String(v).trim();
                        break;
                    }
                }
            }
            if (!caseDetailsVal) {
                caseDetailsVal = (lead.caseDetails || lead.case_details || lead.case_status || '')?.toString().trim();
            }
            // PSM extractor from Excel
            let psmVal = '';
            for (const [k, v] of Object.entries(lead)) {
                const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanK === 'psm' || cleanK === 'psmname') {
                    if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim().toUpperCase() !== 'N/A') {
                        psmVal = String(v).trim();
                        break;
                    }
                }
            }
            if (!psmVal) {
                psmVal = (lead.psm || lead.psmName || '')?.toString().trim();
            }
            // Amount / Budget extractor from Excel
            let budgetVal = '';
            for (const [k, v] of Object.entries(lead)) {
                const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanK === 'amount' || cleanK === 'loanamount' || cleanK === 'budget' || cleanK === 'reqamount') {
                    if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim().toUpperCase() !== 'N/A') {
                        budgetVal = String(v).trim();
                        break;
                    }
                }
            }
            if (!budgetVal) {
                budgetVal = (lead.budget || lead.amount || lead.loanAmount || '')?.toString().trim();
            }
            recordsToCreate.push({
                organizationId: orgId,
                moduleId: leadModule._id,
                createdBy: userId,
                updatedBy: userId,
                data: {
                    ...lead,
                    firstName: fName,
                    lastName: lName,
                    phone: phoneVal,
                    mobile: phoneVal,
                    contactNumber: phoneVal,
                    name_contact_num: phoneVal,
                    mobileNo: phoneVal,
                    email: lead.email || '',
                    loanType: rawLoanType,
                    product: rawLoanType,
                    leadCategory: rawCategory,
                    lead_category: rawCategory,
                    budget: budgetVal,
                    amount: budgetVal,
                    loanAmount: budgetVal,
                    company: firmVal,
                    firmName: firmVal,
                    firm_name: firmVal,
                    salary: lead.salary || '',
                    city: locationVal,
                    location: locationVal,
                    presentAddress: locationVal,
                    dataCode: finalDataCode,
                    data_code: finalDataCode,
                    bankPartner: bankPartnerVal,
                    bank: bankPartnerVal,
                    caseDetails: caseDetailsVal,
                    psm: psmVal,
                    notes: lead.notes || lead.remarks || lead.remark || lead['Remarks'] || lead['remarks'] || '',
                    remarks: lead.notes || lead.remarks || lead.remark || lead['Remarks'] || lead['remarks'] || '',
                    status: lead.status || 'New',
                    dialStatus: 'Yet To Call',
                    source: campaignName,
                    campaign: campaignName,
                    campaignName: campaignName,
                    assignedTo: assignedAgent, // campaign telecaller
                    telecaller: assignedAgent,
                    pendingAt: '', // empty until user creates lead via Create Lead
                    assignToTeam: '',
                    isLeadCreated: false,
                    leadCreated: false,
                    fullName: `${fName} ${lName}`.trim(),
                    customerName: `${fName} ${lName}`.trim()
                }
            });
        });
        // Bulk insert custom records
        const result = await CustomRecord_1.default.insertMany(recordsToCreate);
        // Invalidate allocation stats cache so counts refresh instantly
        cache_1.serverCache.invalidatePattern(`campaigns:alloc-stats:${orgId}`);
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
const EXCLUDED_CAMPAIGN_STATUSES = new Set([
    'REJECTED',
    'DROPPED',
    'DISBUSED',
    'DISBURSED',
    'APPROVE BUT NOT DISBUSE',
    'APPROVED BUT NOT DISBUSE',
    'APPROVAL PENDING',
    'DOCUMENT PENDING',
    'CEBIL PENDING',
    'CIBIL PENDING',
    'CEDIL PENDING',
    'PENDING'
]);
const DEFAULT_CAMPAIGN_STATUSES = [
    'Yet To Call',
    'Hot Leads',
    'Warm Leads',
    'Cool Lead',
    'Followup',
    'Not Interested',
    'Call Rejected',
    'Not Connected',
    'No Answer',
    'Number Busy',
    'Out of Service',
    'No Incoming Calls',
    'Switch Off',
    'Not Reachable',
    'Wrong Number',
    'Not Exists',
    'Repeated Number',
    'No Business'
];
const DEFAULT_TRIGGER_STATUSES = ['HOT LEADS', 'WARM LEADS'];
const DEFAULT_DASHBOARD_STATUSES = ['HOT LEADS', 'WARM LEADS', 'COOL LEAD', 'FOLLOWUP'];
// GET campaign statuses, trigger statuses (Opens Create Lead), and dashboard statuses (Show in Dashboard)
router.get('/campaigns/statuses', async (req, res) => {
    try {
        const orgId = req.organizationId;
        const org = await Organization_1.default.findById(orgId);
        const config = org?.themeSettings?.campaignStatusConfig;
        let statuses = Array.isArray(config?.statuses) && config.statuses.length > 0
            ? config.statuses.filter((s) => !EXCLUDED_CAMPAIGN_STATUSES.has(String(s).trim().toUpperCase()))
            : [...DEFAULT_CAMPAIGN_STATUSES];
        // Ensure the new required statuses are present
        const requiredStatuses = ['Number Busy', 'Out of Service', 'No Incoming Calls', 'Switch Off'];
        requiredStatuses.forEach(rs => {
            const exists = statuses.some((s) => s.trim().toUpperCase() === rs.toUpperCase());
            if (!exists)
                statuses.push(rs);
        });
        // Opens Create Lead triggers
        let triggerStatuses = Array.isArray(config?.triggerStatuses) && config.triggerStatuses.length > 0
            ? config.triggerStatuses.filter((s) => !EXCLUDED_CAMPAIGN_STATUSES.has(String(s).trim().toUpperCase()))
            : [...DEFAULT_TRIGGER_STATUSES];
        // Show in Dashboard statuses: synchronize with PostgreSQL 'statuses' table
        const dbStatuses = await Status_1.default.find({ organizationId: orgId });
        const dbDashboardVisibleNames = dbStatuses
            .filter((st) => st.dashboardVisibility !== false && !EXCLUDED_CAMPAIGN_STATUSES.has(String(st.name || '').trim().toUpperCase()))
            .map((st) => String(st.name || '').trim().toUpperCase());
        let dashboardStatuses;
        if (Array.isArray(config?.dashboardStatuses)) {
            dashboardStatuses = Array.from(new Set(config.dashboardStatuses.filter((s) => !EXCLUDED_CAMPAIGN_STATUSES.has(String(s).trim().toUpperCase()))));
        }
        else if (dbDashboardVisibleNames.length > 0) {
            dashboardStatuses = Array.from(new Set([
                ...dbDashboardVisibleNames,
                'COOL LEAD'
            ]));
        }
        else {
            dashboardStatuses = [...DEFAULT_DASHBOARD_STATUSES];
        }
        res.status(200).json({
            statuses,
            triggerStatuses,
            dashboardStatuses
        });
    }
    catch (error) {
        console.error('Failed to get campaign statuses:', error);
        res.status(500).json({ error: error.message || 'Failed to get campaign statuses' });
    }
});
// PUT update campaign statuses, triggers (Opens Create Lead), and dashboard visibility (Show in Dashboard)
router.put('/campaigns/statuses', async (req, res) => {
    try {
        const orgId = req.organizationId;
        const { statuses, triggerStatuses, dashboardStatuses } = req.body;
        if (!Array.isArray(statuses)) {
            res.status(400).json({ error: 'Statuses must be an array of status names.' });
            return;
        }
        const org = await Organization_1.default.findById(orgId);
        if (!org) {
            res.status(404).json({ error: 'Organization not found.' });
            return;
        }
        const cleanedStatuses = Array.from(new Set(statuses
            .map((s) => String(s || '').trim())
            .filter((s) => Boolean(s) && !EXCLUDED_CAMPAIGN_STATUSES.has(s.toUpperCase()))));
        const cleanedTrigger = Array.from(new Set((triggerStatuses || [])
            .map((s) => String(s || '').trim().toUpperCase())
            .filter((s) => Boolean(s) && !EXCLUDED_CAMPAIGN_STATUSES.has(s))));
        const cleanedDashboard = Array.from(new Set((dashboardStatuses || [])
            .map((s) => String(s || '').trim().toUpperCase())
            .filter((s) => Boolean(s) && !EXCLUDED_CAMPAIGN_STATUSES.has(s))));
        const campaignStatusConfig = {
            statuses: cleanedStatuses.length > 0 ? cleanedStatuses : DEFAULT_CAMPAIGN_STATUSES,
            triggerStatuses: cleanedTrigger,
            dashboardStatuses: cleanedDashboard
        };
        org.themeSettings = {
            ...(org.themeSettings || {}),
            campaignStatusConfig
        };
        await org.save();
        // 2-Way Synchronization with PostgreSQL 'statuses' table
        try {
            const existingDbStatuses = await Status_1.default.find({ organizationId: orgId });
            const existingMap = new Map();
            existingDbStatuses.forEach((st) => {
                existingMap.set(String(st.name || '').trim().toUpperCase(), st);
            });
            // Campaign statuses that are explicitly marked for Dashboard (e.g. COOL LEAD, FOLLOWUP)
            for (const dashStatusName of cleanedDashboard) {
                const upper = dashStatusName.toUpperCase();
                const strippedUpper = upper.replace(/\s+LEADS?$/i, '').trim();
                let existing = existingMap.get(upper);
                if (!existing && strippedUpper) {
                    existing = existingMap.get(strippedUpper) || existingMap.get(`${strippedUpper} LEAD`) || existingMap.get(`${strippedUpper} LEADS`);
                }
                if (existing) {
                    if (existing.dashboardVisibility !== true) {
                        existing.dashboardVisibility = true;
                        await existing.save();
                    }
                }
                else {
                    // Create new status in statuses table ONLY because it was marked for Dashboard
                    let color = '#06B6D4';
                    let icon = 'Snowflake';
                    if (upper.includes('HOT')) {
                        color = '#EF4444';
                        icon = 'Flame';
                    }
                    else if (upper.includes('WARM')) {
                        color = '#F59E0B';
                        icon = 'Sun';
                    }
                    else if (upper.includes('FOLLOW')) {
                        color = '#0284C7';
                        icon = 'PhoneCall';
                    }
                    await Status_1.default.create({
                        organizationId: orgId,
                        name: dashStatusName,
                        color,
                        icon,
                        pipelinePosition: existingDbStatuses.length + 1,
                        dashboardVisibility: true,
                        isFinal: false,
                        isSuccess: false,
                        order: existingDbStatuses.length + 1
                    });
                }
            }
            // If a campaign-only status is NOT in cleanedDashboard, and it exists in statuses table:
            // Remove it from statuses table so Settings > Status stays clean!
            const CAMPAIGN_NON_PIPELINE = new Set([
                'YET TO CALL', 'NOT CALLED', 'NOT INTERESTED', 'CALL REJECTED', 'NOT CONNECTED',
                'NO ANSWER', 'NUMBER BUSY', 'OUT OF SERVICE', 'NO INCOMING CALLS', 'SWITCH OFF',
                'NOT REACHABLE', 'WRONG NUMBER', 'NOT EXISTS', 'REPEATED NUMBER', 'NO BUSINESS',
                'CALL LATER', 'DROPPED', 'PENDING'
            ]);
            for (const st of existingDbStatuses) {
                const u = String(st.name || '').trim().toUpperCase();
                if (CAMPAIGN_NON_PIPELINE.has(u) && !cleanedDashboard.includes(u)) {
                    await (0, postgres_1.queryPg)('DELETE FROM statuses WHERE id = $1', [st._id || st.id]);
                }
            }
        }
        catch (syncErr) {
            console.warn('Error syncing campaign statuses with Status table:', syncErr);
        }
        cache_1.CacheInvalidators.invalidateStatuses(orgId);
        cache_1.CacheInvalidators.invalidateDashboard(orgId);
        cache_1.serverCache.clear();
        res.status(200).json({
            success: true,
            statuses: campaignStatusConfig.statuses,
            triggerStatuses: campaignStatusConfig.triggerStatuses,
            dashboardStatuses: campaignStatusConfig.dashboardStatuses
        });
    }
    catch (error) {
        console.error('Failed to update campaign statuses:', error);
        res.status(500).json({ error: error.message || 'Failed to update campaign statuses' });
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
        const userScopeKey = `${userId}:${req.user?.roleId || 'role'}`;
        const cacheKey = cache_1.CacheKeys.campaigns(orgId, userScopeKey);
        const cached = cache_1.serverCache.get(cacheKey);
        if (cached) {
            res.setHeader('X-Cache', 'HIT');
            res.status(200).json({ campaigns: cached });
            return;
        }
        // 1. Get registered campaigns from the Campaigns module
        const campaignModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'campaigns' });
        let campaignRecords = [];
        if (campaignModule) {
            campaignRecords = await CustomRecord_1.default.find({
                organizationId: orgId,
                moduleId: campaignModule._id
            }).select('_id data.campaignName data.name data.source createdAt').lean();
        }
        const registeredCampaignNames = new Set(campaignRecords.map((c) => {
            const d = c.data || {};
            return (d.campaignName || d.name || d.source || '').toString().trim().toLowerCase();
        }).filter(Boolean));
        // If there are no registered campaigns in Campaigns list, return empty array immediately!
        if (registeredCampaignNames.size === 0) {
            cache_1.serverCache.set(cacheKey, [], 60);
            res.setHeader('X-Cache', 'MISS');
            res.status(200).json({ campaigns: [] });
            return;
        }
        // 2. Get the leads module
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'leads' });
        if (!leadModule) {
            cache_1.serverCache.set(cacheKey, [], 60);
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
        // Reporting managers see only their own campaigns, NOT their subordinates' campaigns!
        // Subordinates' leads are visible in Leads Process, but NOT in Campaigns.
        // Super admins see all campaigns across the organization.
        const isSuper = await hierarchy_1.HierarchyService.isSuperAdmin(req.user?.roleId);
        if (!isSuper) {
            const currentUser = await User_1.default.findOne({ _id: userId, organizationId: orgId }).select('_id firstName lastName email userCode');
            const userFilters = [
                { createdBy: userId },
                { 'data.assignedTo': userId.toString() }
            ];
            if (currentUser) {
                const fullName = `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim();
                if (fullName) {
                    const escName = fullName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    userFilters.push({ 'data.assignedTo': new RegExp('^\\s*' + escName + '\\s*$', 'i') });
                }
                if (currentUser.firstName) {
                    const escFirst = currentUser.firstName.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    userFilters.push({ 'data.assignedTo': new RegExp('^\\s*' + escFirst + '\\s*$', 'i') });
                }
                if (currentUser.email) {
                    const escEmail = currentUser.email.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    userFilters.push({ 'data.assignedTo': new RegExp('^\\s*' + escEmail + '\\s*$', 'i') });
                }
                if (currentUser.userCode) {
                    const escCode = currentUser.userCode.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    userFilters.push({ 'data.assignedTo': new RegExp('^\\s*' + escCode + '\\s*$', 'i') });
                }
            }
            leadQuery.$and = [
                { $or: leadQuery.$or },
                { $or: userFilters }
            ];
            delete leadQuery.$or;
        }
        const LEAD_CAMPAIGN_PROJECTION = '_id data.source data.campaignName data.campaign data.campaign_name data.dialStatus data.status data.callAttempts data.dialedAt createdAt';
        const leads = await CustomRecord_1.default.find(leadQuery).select(LEAD_CAMPAIGN_PROJECTION).lean();
        // Initialize campaignGroups for ALL registered campaigns so campaigns created in Campaigns list always appear
        const campaignGroups = {};
        campaignRecords.forEach((c) => {
            const d = c.data || {};
            const name = (d.campaignName || d.name || d.source || '').toString().trim();
            if (name) {
                campaignGroups[name] = [];
            }
        });
        // Group leads by registered campaign name strictly
        leads.forEach((lead) => {
            const d = lead.data || {};
            const rawSource = (d.campaignName ||
                d.campaign ||
                d.campaign_name ||
                d.source)?.toString().trim();
            if (rawSource) {
                const lower = rawSource.toLowerCase();
                // A campaign lead MUST belong to an existing registered campaign!
                if (registeredCampaignNames.has(lower)) {
                    // Find canonical name from registered campaign
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
        cache_1.serverCache.set(cacheKey, result, 60);
        res.setHeader('X-Cache', 'MISS');
        res.status(200).json({ campaigns: result });
    }
    catch (error) {
        console.error('Failed to get my campaigns:', error);
        res.status(500).json({ error: 'Failed to retrieve campaigns.' });
    }
});
// GET my campaign details (assigned leads under campaignName with instant pagination & background prefetching support)
router.get('/campaigns/my-campaigns/details/:campaignName', async (req, res) => {
    try {
        const orgId = req.organizationId;
        const userId = req.user?.id;
        const { campaignName } = req.params;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized.' });
            return;
        }
        const decodedCampaignName = decodeURIComponent(campaignName).trim();
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const isAll = req.query.all === 'true';
        const limit = isAll ? 0 : Math.max(1, parseInt(req.query.limit) || 10);
        const tab = (req.query.tab || req.query.filter || 'all').trim();
        const search = (req.query.search || '').trim();
        const detailsCacheKey = cache_1.CacheKeys.campaignDetails(orgId, `${userId}:${decodedCampaignName}:${page}:${limit}:${tab}:${search}:${isAll}`);
        const cachedDetails = cache_1.serverCache.get(detailsCacheKey);
        if (cachedDetails) {
            res.setHeader('X-Cache', 'HIT');
            res.status(200).json(cachedDetails);
            return;
        }
        const isSuper = await hierarchy_1.HierarchyService.isSuperAdmin(req.user?.roleId);
        const currentUser = await User_1.default.findOne({ _id: userId, organizationId: orgId }).select('_id firstName lastName email userCode');
        // Get the leads module
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'leads' });
        const moduleId = leadModule?._id || leadModule?.id;
        const escName = decodedCampaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        // Verify the campaign exists in registered campaigns module
        const campaignModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'campaigns' });
        if (campaignModule) {
            const exists = await CustomRecord_1.default.findOne({
                organizationId: orgId,
                moduleId: campaignModule._id,
                $or: [
                    { 'data.campaignName': new RegExp(`^\\s*${escName}\\s*$`, 'i') },
                    { 'data.name': new RegExp(`^\\s*${escName}\\s*$`, 'i') },
                    { 'data.source': new RegExp(`^\\s*${escName}\\s*$`, 'i') }
                ]
            });
            if (!exists) {
                res.status(200).json({
                    leads: [],
                    stats: { totalAllocated: 0, dialed: 0, yetToDial: 0, overallRate: 0 },
                    pagination: { total: 0, page: 1, limit, totalPages: 1 }
                });
                return;
            }
        }
        // 1. Ultra-fast indexed PostgreSQL direct execution (<25ms)
        try {
            const baseParams = [orgId];
            let baseConds = ['organization_id = $1'];
            if (moduleId) {
                baseParams.push(moduleId);
                baseConds.push(`module_id = $${baseParams.length}`);
            }
            baseParams.push(decodedCampaignName);
            const campParamIdx = baseParams.length;
            baseConds.push(`(
        LOWER(data->>'campaignName') = LOWER($${campParamIdx}) OR
        LOWER(data->>'campaign') = LOWER($${campParamIdx}) OR
        LOWER(data->>'source') = LOWER($${campParamIdx}) OR
        LOWER(data->>'campaign_name') = LOWER($${campParamIdx})
      )`);
            // Reporting managers see only their own assigned records in the telecalling view
            // When exporting the full campaign (isAll = true) or for Super Admin, include all allocated records
            if (!isSuper && !isAll) {
                const userTerms = [
                    userId.toString(),
                    currentUser?.userCode,
                    currentUser?.email,
                    `${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`.trim(),
                    currentUser?.firstName
                ].filter(Boolean);
                const userConds = [];
                userTerms.forEach(term => {
                    baseParams.push(term);
                    userConds.push(`LOWER(data->>'assignedTo') = LOWER($${baseParams.length})`);
                });
                baseParams.push(userId.toString());
                userConds.push(`created_by = $${baseParams.length}`);
                baseConds.push(`(${userConds.join(' OR ')})`);
            }
            const baseWhere = baseConds.join(' AND ');
            // Query total overall stats for this campaign (<5ms)
            const statsSql = `
        SELECT 
          COUNT(*)::int as total_allocated,
          COUNT(CASE WHEN 
            (data->>'dialedAt' IS NOT NULL AND data->>'dialedAt' != '') OR 
            (LOWER(COALESCE(data->>'dialStatus', data->>'status', '')) NOT IN ('', 'yet to call', 'not called', 'new'))
          THEN 1 END)::int as dialed
        FROM custom_records
        WHERE ${baseWhere}
      `;
            // Now build current filtered query
            const filterParams = [...baseParams];
            const filterConds = [...baseConds];
            if (tab === 'dialed') {
                filterConds.push(`(
          (data->>'dialedAt' IS NOT NULL AND data->>'dialedAt' != '') OR 
          (LOWER(COALESCE(data->>'dialStatus', data->>'status', '')) NOT IN ('', 'yet to call', 'not called', 'new'))
        )`);
            }
            else if (tab === 'yetToDial') {
                filterConds.push(`(
          (data->>'dialedAt' IS NULL OR data->>'dialedAt' = '') AND 
          (LOWER(COALESCE(data->>'dialStatus', data->>'status', '')) IN ('', 'yet to call', 'not called', 'new'))
        )`);
            }
            if (search) {
                filterParams.push(`%${search}%`);
                const searchIdx = filterParams.length;
                filterConds.push(`(
          (data->>'firstName') ILIKE $${searchIdx} OR
          (data->>'lastName') ILIKE $${searchIdx} OR
          (data->>'customerName') ILIKE $${searchIdx} OR
          (data->>'customer') ILIKE $${searchIdx} OR
          (data->>'company') ILIKE $${searchIdx} OR
          (data->>'firmName') ILIKE $${searchIdx} OR
          (data->>'firm_name') ILIKE $${searchIdx} OR
          (data->>'phone') ILIKE $${searchIdx} OR
          (data->>'mobile') ILIKE $${searchIdx} OR
          (data->>'contactNumber') ILIKE $${searchIdx} OR
          (data->>'name_contact_num') ILIKE $${searchIdx} OR
          (data->>'dataCode') ILIKE $${searchIdx} OR
          (data->>'data_code') ILIKE $${searchIdx} OR
          (data->>'city') ILIKE $${searchIdx} OR
          (data->>'location') ILIKE $${searchIdx} OR
          (data->>'notes') ILIKE $${searchIdx} OR
          (data->>'remarks') ILIKE $${searchIdx} OR
          (data->>'caseDetails') ILIKE $${searchIdx} OR
          (data->>'leadCategory') ILIKE $${searchIdx} OR
          (data->>'loanType') ILIKE $${searchIdx}
        )`);
            }
            const filteredWhere = filterConds.join(' AND ');
            // Fetch page data with LIMIT, OFFSET and single-pass count(*) OVER() sorted ASCENDING (01 -> 3726)
            let fetchSql = `
        SELECT id, data, created_at, updated_at ${limit > 0 ? ', count(*) OVER() as full_count' : ''}
        FROM custom_records
        WHERE ${filteredWhere}
        ORDER BY created_at ASC, id ASC
      `;
            const fetchParams = [...filterParams];
            if (limit > 0) {
                const skip = (page - 1) * limit;
                fetchParams.push(limit);
                fetchSql += ` LIMIT $${fetchParams.length}`;
                fetchParams.push(skip);
                fetchSql += ` OFFSET $${fetchParams.length}`;
            }
            // Execute stats and fetch simultaneously in parallel for instant response (<25ms)
            const [statsRes, rows] = await Promise.all([
                (0, postgres_1.queryPg)(statsSql, baseParams),
                (0, postgres_1.queryPg)(fetchSql, fetchParams)
            ]);
            const totalAllocated = statsRes[0]?.total_allocated || 0;
            const dialed = statsRes[0]?.dialed || 0;
            const yetToDial = Math.max(0, totalAllocated - dialed);
            let filteredTotal = 0;
            if (limit === 0) {
                filteredTotal = rows.length;
            }
            else if (rows.length > 0) {
                filteredTotal = parseInt(rows[0].full_count, 10) || rows.length;
            }
            else if (tab === 'all' && !search) {
                filteredTotal = totalAllocated;
            }
            else if (tab === 'dialed' && !search) {
                filteredTotal = dialed;
            }
            else if (tab === 'yetToDial' && !search) {
                filteredTotal = yetToDial;
            }
            const leads = rows.map((r) => {
                const d = { ...(r.data || {}) };
                // 1. Ensure customerName / leadName is populated from any available column
                let rawCust = String(d.customerName || d.firstName || '').trim();
                if (!rawCust || ['UNNAMED', 'N/A', 'UNDEFINED', 'NULL'].includes(rawCust.toUpperCase())) {
                    for (const [k, v] of Object.entries(d)) {
                        const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (cleanK.includes('company') || cleanK.includes('firm') || cleanK.includes('bank') || cleanK.includes('psm') || cleanK.includes('campaign') || cleanK.includes('source') || cleanK.includes('assignedto') || cleanK.includes('agent'))
                            continue;
                        if (cleanK.includes('customer') || cleanK.includes('client') || cleanK.includes('leadname') ||
                            cleanK.includes('applicant') || cleanK.includes('borrower') || cleanK.includes('party') ||
                            cleanK.includes('contactperson') || cleanK.includes('custname') || cleanK === 'name' || cleanK === 'fullname' || cleanK === 'firstname' || cleanK === 'lead') {
                            if (v && String(v).trim() && !['UNNAMED', 'N/A', 'UNDEFINED', 'NULL'].includes(String(v).trim().toUpperCase())) {
                                d.customerName = String(v).trim();
                                d.firstName = String(v).trim();
                                d.fullName = String(v).trim();
                                break;
                            }
                        }
                    }
                }
                // 2. Ensure phone / mobile is populated from any available column
                let rawPhone = String(d.phone || d.mobile || d.contactNumber || d.mobileNo || '').trim();
                if (!rawPhone || ['N/A', 'UNDEFINED', 'NULL', 'XXXXXXXXXX'].includes(rawPhone.toUpperCase())) {
                    for (const [k, v] of Object.entries(d)) {
                        const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (cleanK.includes('psm') || cleanK.includes('datacode') || cleanK.includes('leadno') || cleanK.includes('slno'))
                            continue;
                        if (cleanK.includes('phone') || cleanK.includes('mobile') || cleanK.includes('contact') ||
                            cleanK.includes('cell') || cleanK.includes('mob') || cleanK.includes('tel') ||
                            cleanK.includes('calling') || cleanK.includes('dial') || cleanK === 'number' || cleanK === 'no') {
                            if (v && String(v).trim() && !['N/A', 'UNDEFINED', 'NULL'].includes(String(v).trim().toUpperCase())) {
                                const cleanP = String(v).trim().replace(/\.0+$/, '');
                                d.phone = cleanP;
                                d.mobile = cleanP;
                                d.contactNumber = cleanP;
                                break;
                            }
                        }
                    }
                }
                // 3. Ensure city / location is populated from any available column
                let rawLoc = String(d.city || d.location || d.place || '').trim();
                if (!rawLoc || ['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(rawLoc.toUpperCase())) {
                    for (const [k, v] of Object.entries(d)) {
                        const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (cleanK.includes('location') || cleanK.includes('city') || cleanK.includes('place') ||
                            cleanK.includes('area') || cleanK.includes('district') || cleanK.includes('branch') ||
                            cleanK.includes('address') || cleanK.includes('state') || cleanK.includes('town') ||
                            cleanK.includes('zone') || cleanK.includes('region')) {
                            if (v && String(v).trim() && !['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(String(v).trim().toUpperCase())) {
                                d.city = String(v).trim();
                                d.location = String(v).trim();
                                break;
                            }
                        }
                    }
                }
                // 4. Ensure dataCode is populated from any available column
                let rawCode = String(d.dataCode || d.data_code || d.code || '').trim();
                if (!rawCode || ['N/A', 'UNDEFINED', 'NULL'].includes(rawCode.toUpperCase())) {
                    for (const [k, v] of Object.entries(d)) {
                        const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (cleanK.includes('datacode') || cleanK.includes('leadcode') || cleanK.includes('customercode') || cleanK.includes('datano') || cleanK === 'code' || cleanK === 'dcode') {
                            if (v && String(v).trim() && !['N/A', 'UNDEFINED', 'NULL'].includes(String(v).trim().toUpperCase())) {
                                d.dataCode = String(v).trim();
                                d.data_code = String(v).trim();
                                break;
                            }
                        }
                    }
                }
                // 5. Ensure company / firm is populated from any available column
                let rawFirm = String(d.company || d.firm || d.firmName || d.firm_name || '').trim();
                if (!rawFirm || ['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(rawFirm.toUpperCase())) {
                    for (const [k, v] of Object.entries(d)) {
                        const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (cleanK.includes('company') || cleanK.includes('firm') || cleanK.includes('employer') || cleanK.includes('organization') || cleanK.includes('business')) {
                            if (v && String(v).trim() && !['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(String(v).trim().toUpperCase())) {
                                d.company = String(v).trim();
                                d.firmName = String(v).trim();
                                break;
                            }
                        }
                    }
                }
                // 6. Ensure leadCategory is populated from any available column
                let rawCat = String(d.leadCategory || d.lead_category || d.category || '').trim();
                if (!rawCat || ['N/A', 'UNDEFINED', 'NULL', 'PERSONAL LOAN'].includes(rawCat.toUpperCase())) {
                    for (const [k, v] of Object.entries(d)) {
                        const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (cleanK.includes('leadcat') || cleanK.includes('category') || cleanK.includes('leadtype') || cleanK.includes('cattype')) {
                            if (v && String(v).trim() && !['N/A', 'UNDEFINED', 'NULL', 'PERSONAL LOAN'].includes(String(v).trim().toUpperCase())) {
                                d.leadCategory = String(v).trim();
                                d.lead_category = String(v).trim();
                                break;
                            }
                        }
                    }
                }
                const isDialed = d.dialedAt || d.lastCallDate || (d.callAttempts && Number(d.callAttempts) > 0) ||
                    (d.status && !['YET TO CALL', 'NOT CALLED', 'NEW', 'YET TO DIAL'].includes(String(d.status).trim().toUpperCase()));
                if (!isDialed) {
                    if (d.psm && (d.psm === d.assignedTo || d.psm === decodedCampaignName || String(d.psm).toUpperCase() === 'N/A' || String(d.psm).includes('DEMO'))) {
                        delete d.psm;
                        delete d.psmName;
                    }
                }
                return {
                    _id: r.id,
                    id: r.id,
                    data: d,
                    createdAt: r.created_at,
                    updatedAt: r.updated_at
                };
            });
            const payload = {
                leads,
                total: filteredTotal,
                page,
                limit: limit || filteredTotal,
                totalPages: limit > 0 ? Math.ceil(filteredTotal / limit) : 1,
                totalAllocated,
                dialed,
                yetToDial
            };
            cache_1.serverCache.set(detailsCacheKey, payload, 30);
            res.setHeader('X-Cache', 'MISS');
            res.status(200).json(payload);
            return;
        }
        catch (pgErr) {
            console.warn('Fast PG query failed, falling back to model query:', pgErr);
        }
        // 2. Graceful Fallback via CustomRecord Model
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
            ...(moduleId ? { moduleId } : {}),
            ...matchFilter
        };
        if (!isSuper && !isAll) {
            const userFilters = [
                { createdBy: userId },
                { 'data.assignedTo': userId.toString() }
            ];
            if (currentUser) {
                const fullName = `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim();
                if (fullName) {
                    const escName = fullName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    userFilters.push({ 'data.assignedTo': new RegExp('^\\s*' + escName + '\\s*$', 'i') });
                }
                if (currentUser.firstName) {
                    const escFirst = currentUser.firstName.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    userFilters.push({ 'data.assignedTo': new RegExp('^\\s*' + escFirst + '\\s*$', 'i') });
                }
                if (currentUser.email) {
                    const escEmail = currentUser.email.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    userFilters.push({ 'data.assignedTo': new RegExp('^\\s*' + escEmail + '\\s*$', 'i') });
                }
                if (currentUser.userCode) {
                    const escCode = currentUser.userCode.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    userFilters.push({ 'data.assignedTo': new RegExp('^\\s*' + escCode + '\\s*$', 'i') });
                }
            }
            query.$and = [{ $or: userFilters }];
        }
        const LEAD_PROJECTION = '_id data.firstName data.lastName data.customerName data.customer data.company data.firmName data.firm_name data.phone data.mobile data.mobileNo data.contactNumber data.name_contact_num data.contactNum data.contact_num data.phoneNumber data.phone_number data.contact data.city data.location data.dataCode data.data_code data.status data.dialStatus data.notes data.remarks data.caseDetails data.leadCategory data.lead_category data.loanType data.businessPartner data.bank data.bankName data.budget data.amount data.assignedTo data.callAttempts data.dialedAt data.source data.campaignName data.createdDate createdAt';
        const totalCount = await CustomRecord_1.default.countDocuments(query);
        const queryChain = CustomRecord_1.default.find(query).select('_id data createdBy updatedBy createdAt updatedAt').sort({ createdAt: -1 });
        if (limit > 0) {
            queryChain.skip((page - 1) * limit).limit(limit);
        }
        const rawLeads = await queryChain.lean();
        const leads = rawLeads.map((l) => {
            const d = { ...(l.data || {}) };
            const rawCust = String(d.customerName || d.firstName || '').trim();
            if (!rawCust || rawCust.toUpperCase() === 'UNNAMED' || rawCust.toUpperCase() === 'N/A') {
                let altName = '';
                for (const [k, v] of Object.entries(d)) {
                    const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (cleanK.includes('company') || cleanK.includes('firm') || cleanK.includes('bank') || cleanK.includes('psm') || cleanK.includes('campaign') || cleanK.includes('source') || cleanK.includes('assignedto') || cleanK.includes('agent'))
                        continue;
                    if (cleanK.includes('customer') || cleanK.includes('client') || cleanK.includes('leadname') ||
                        cleanK.includes('applicant') || cleanK.includes('borrower') || cleanK.includes('party') ||
                        cleanK.includes('contactperson') || cleanK.includes('custname') || cleanK === 'name' || cleanK === 'fullname' || cleanK === 'firstname' || cleanK === 'lead') {
                        if (v && String(v).trim() && !['UNNAMED', 'N/A', 'UNDEFINED', 'NULL'].includes(String(v).trim().toUpperCase())) {
                            altName = String(v).trim();
                            break;
                        }
                    }
                }
                if (altName) {
                    d.customerName = altName;
                    d.firstName = altName;
                    d.fullName = altName;
                }
            }
            // Universal phone extractor fallback
            if (!d.phone && !d.mobile) {
                for (const [k, v] of Object.entries(d)) {
                    const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (cleanK.includes('psm') || cleanK.includes('datacode') || cleanK.includes('leadno') || cleanK.includes('slno'))
                        continue;
                    if (cleanK.includes('phone') || cleanK.includes('mobile') ||
                        cleanK.includes('contact') || cleanK.includes('cell') ||
                        cleanK.includes('mob') || cleanK.includes('tel') || cleanK.includes('calling') || cleanK.includes('dial') || cleanK === 'number' || cleanK === 'no') {
                        if (v && String(v).trim() && !['N/A', 'UNDEFINED', 'NULL'].includes(String(v).trim().toUpperCase())) {
                            const cleanP = String(v).trim().replace(/\.0+$/, '');
                            d.phone = cleanP;
                            d.mobile = cleanP;
                            d.mobileNo = cleanP;
                            break;
                        }
                    }
                }
            }
            // Universal city / location fallback
            if (!d.city && !d.location) {
                for (const [k, v] of Object.entries(d)) {
                    const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (cleanK.includes('location') || cleanK.includes('city') || cleanK.includes('place') ||
                        cleanK.includes('area') || cleanK.includes('district') || cleanK.includes('branch') ||
                        cleanK.includes('address') || cleanK.includes('state') || cleanK.includes('town')) {
                        if (v && String(v).trim() && !['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(String(v).trim().toUpperCase())) {
                            d.city = String(v).trim();
                            d.location = String(v).trim();
                            break;
                        }
                    }
                }
            }
            // Universal dataCode fallback
            if (!d.dataCode && !d.data_code) {
                for (const [k, v] of Object.entries(d)) {
                    const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (cleanK.includes('datacode') || cleanK.includes('leadcode') || cleanK.includes('customercode') || cleanK.includes('datano') || cleanK === 'code' || cleanK === 'dcode') {
                        if (v && String(v).trim() && !['N/A', 'UNDEFINED', 'NULL'].includes(String(v).trim().toUpperCase())) {
                            d.dataCode = String(v).trim();
                            d.data_code = String(v).trim();
                            break;
                        }
                    }
                }
            }
            // Universal company / firm fallback
            if (!d.company && !d.firm) {
                for (const [k, v] of Object.entries(d)) {
                    const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (cleanK.includes('company') || cleanK.includes('firm') || cleanK.includes('employer') || cleanK.includes('organization') || cleanK.includes('business')) {
                        if (v && String(v).trim() && !['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(String(v).trim().toUpperCase())) {
                            d.company = String(v).trim();
                            d.firmName = String(v).trim();
                            break;
                        }
                    }
                }
            }
            const isDialed = d.dialedAt || d.lastCallDate || (d.callAttempts && Number(d.callAttempts) > 0) ||
                (d.status && !['YET TO CALL', 'NOT CALLED', 'NEW', 'YET TO DIAL'].includes(String(d.status).trim().toUpperCase()));
            if (!isDialed) {
                if (d.psm && (d.psm === d.assignedTo || d.psm === decodedCampaignName || String(d.psm).toUpperCase() === 'N/A' || String(d.psm).includes('DEMO'))) {
                    delete d.psm;
                    delete d.psmName;
                }
                if (d.loanType === 'PERSONAL LOAN' || d.loanType === 'PERSONAL DETAILS') {
                    delete d.loanType;
                }
                if (d.leadCategory === 'PERSONAL LOAN') {
                    delete d.leadCategory;
                    delete d.lead_category;
                }
            }
            return { ...l, data: d };
        });
        const payload = {
            leads,
            total: totalCount,
            page,
            limit: limit || totalCount,
            totalPages: limit > 0 ? Math.ceil(totalCount / limit) : 1,
            totalAllocated: totalCount,
            dialed: 0,
            yetToDial: totalCount
        };
        cache_1.serverCache.set(detailsCacheKey, payload, 30);
        res.setHeader('X-Cache', 'MISS');
        res.status(200).json(payload);
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
    // COOL
    if (upper.includes('COOL')) {
        synonyms.add('COOL');
        synonyms.add('COOL LEAD');
        synonyms.add('COOL LEADS');
        synonyms.add('Cool');
        synonyms.add('Cool Lead');
        synonyms.add('Cool Leads');
    }
    // GIVEN LOGIN / LOGIN
    if (upper.includes('LOGIN')) {
        synonyms.add('GIVEN LOGIN');
        synonyms.add('Given Login');
        synonyms.add('LOGIN');
        synonyms.add('Login');
    }
    return Array.from(synonyms).filter(Boolean);
}
// Regex matching official Lead Pipeline Stages (strictly excludes Campaign telecalling contacts)
exports.PIPELINE_LEAD_STATUS_REGEX = '^(HOT(\\s+LEADS?)?|WARM(\\s+LEADS?)?|COOL(\\s+LEADS?)?|GIVEN\\s+LOGIN|LOGIN|CE[BD]IL(\\s+PENDING)?|DOC(UMENT)?S?(\\s+PENDING)?|PROPOSAL|APPROVALS?(\\s+PENDING)?|NEGOTIATION|APPROVED(\\s+BUT\\s+NOT\\s+DISBU(RS|S)E?D?)?|DISBU(RS|S)E?D?|REJECT(ED)?|FOLLOW[- ]?UP|DROP(PED)?|PENDING|INK\\s*WORLDWIDE)$';
// 1. LIST RECORDS FOR A DYNAMIC MODULE
router.get('/:apiPath', async (req, res) => {
    try {
        const { apiPath } = req.params;
        const isMasterModule = ['bankmasters', 'bankingpartners', 'departments', 'products'].includes(apiPath.toLowerCase());
        const defaultLimit = apiPath.toLowerCase() === 'leads' ? '10' : (isMasterModule ? '100' : '50');
        const { search, page = '1', limit = defaultLimit, sort } = req.query;
        const isDefaultList = !search && page === '1';
        const masterCacheKey = isMasterModule && isDefaultList ? cache_1.CacheKeys.masterRecords(req.organizationId, apiPath.toLowerCase()) : null;
        if (masterCacheKey) {
            const cached = cache_1.serverCache.get(masterCacheKey);
            if (cached) {
                res.setHeader('X-Cache', 'HIT');
                res.status(200).json(cached);
                return;
            }
        }
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
            const realLeadRegexStr = await (0, leadStatusHelper_1.getRealLeadRegex)(req.organizationId);
            const realLeadFilter = {
                $or: [
                    { 'data.status': { $regex: realLeadRegexStr, $options: 'i' } },
                    { 'data.leadStatus': { $regex: realLeadRegexStr, $options: 'i' } }
                ]
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
            // 1. Find matching users for createdBy / updatedBy search safely
            let matchedUserIds = [];
            try {
                const matchedUsers = await User_1.default.find({
                    organizationId: req.organizationId,
                    $or: [
                        { firstName: searchRegex },
                        { lastName: searchRegex },
                        { email: searchRegex }
                    ]
                }).select('_id');
                matchedUserIds = (matchedUsers || []).map((u) => u._id);
            }
            catch (err) {
                console.warn('User matching skipped in record search:', err);
            }
            const searchConditions = [
                // Match module dynamic fields
                ...(moduleDef?.fields || [])
                    .filter((f) => ['text', 'email', 'phone', 'rich-text', 'url', 'select', 'number'].includes(f.type))
                    .map((f) => ({ [`data.${f.name}`]: searchRegex })),
                // Match standard lead name and number fields
                { 'data.name': searchRegex },
                { 'data.firstName': searchRegex },
                { 'data.lastName': searchRegex },
                { 'data.fullName': searchRegex },
                { 'data.customerName': searchRegex },
                { 'data.leadName': searchRegex },
                { 'data.applicantName': searchRegex },
                { 'data.clientName': searchRegex },
                { 'data.leadNo': searchRegex },
                { 'data.leadNumber': searchRegex },
                { 'data.lead_no': searchRegex },
                { 'data.leadId': searchRegex },
                { 'data.leadCode': searchRegex },
                { 'data.dataCode': searchRegex },
                { 'data.data_code': searchRegex },
                { 'data.firmName': searchRegex },
                { 'data.company': searchRegex },
                { 'data.companyName': searchRegex },
                { 'data.location': searchRegex },
                { 'data.city': searchRegex },
                { 'data.leadCategory': searchRegex },
                { 'data.phone': searchRegex },
                { 'data.phoneNumber': searchRegex },
                { 'data.mobile': searchRegex },
                { 'data.mobileNumber': searchRegex },
                { 'data.email': searchRegex },
                { 'data.source': searchRegex },
                { 'data.campaign': searchRegex },
                { 'data.campaignName': searchRegex },
                { 'data.status': searchRegex },
                { 'data.remarks': searchRegex },
                { 'data.notes': searchRegex },
                { 'data.caseDetails': searchRegex },
                { 'data.psm': searchRegex },
                { 'data.psmName': searchRegex },
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
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || (isMasterModule ? 100 : 10)), 100);
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
        const responsePayload = {
            records,
            pagination: {
                total,
                totalRecords: total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.max(1, Math.ceil(total / limitNum))
            }
        };
        if (masterCacheKey) {
            cache_1.serverCache.set(masterCacheKey, responsePayload, 600); // 10 minutes cache
            res.setHeader('X-Cache', 'MISS');
        }
        res.status(200).json(responsePayload);
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
        // Auto-populate partnerName for bankingpartners if omitted
        if (apiPath.toLowerCase() === 'bankingpartners') {
            if (!recordData.partnerName && (recordData.bank || recordData.loanType || recordData.psm)) {
                recordData.partnerName = `${recordData.bank || ''} - ${recordData.loanType || ''} - ${recordData.psm || ''}`.trim() || 'Banking Partner';
            }
        }
        // Lead Creator & Permanent Source enforcement
        if (apiPath.toLowerCase() === 'leads') {
            let creatorName = 'Super Admin';
            try {
                const u = await User_1.default.findById(req.user?.id);
                if (u) {
                    creatorName = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email?.split('@')[0] || 'Super Admin';
                }
            }
            catch (_) { }
            // Source is permanently locked to who is creating the lead
            if (!recordData.source || recordData.source === 'Ink CRM' || recordData.source === 'inkcrm') {
                recordData.source = creatorName;
            }
            recordData.creatorName = recordData.source;
            // Brand new lead creation must start with 0 calls and Yet To Call unless explicitly dialed
            if (recordData.callAttempts === undefined || !recordData.dialedAt) {
                recordData.callAttempts = 0;
                delete recordData.dialedAt;
                if (!recordData.dialStatus) {
                    recordData.dialStatus = 'Yet To Call';
                }
            }
            // Auto-generate serial unique Lead Number: 01, 02, 03... (distinct from Data Code)
            if (!recordData.leadNo && !recordData.leadNumber) {
                const leadCount = await CustomRecord_1.default.countDocuments({
                    organizationId: req.organizationId,
                    moduleId: moduleDef._id
                });
                const serialNo = leadCount + 1;
                const formattedLeadNo = String(serialNo).padStart(2, '0');
                recordData.leadNo = formattedLeadNo;
                recordData.leadNumber = formattedLeadNo;
            }
            // Data Code is strictly from campaign assignment, completely separate from Lead Number
            const incomingDataCode = (recordData.dataCode || recordData.data_code || recordData.code || '').toString().trim();
            if (incomingDataCode && !incomingDataCode.startsWith('LND-') && !incomingDataCode.startsWith('DC-')) {
                recordData.dataCode = incomingDataCode;
                recordData.data_code = incomingDataCode;
            }
            else if (recordData.campaignName || recordData.campaign) {
                const camp = String(recordData.campaignName || recordData.campaign).trim().toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-');
                recordData.dataCode = `${camp}-DATA-${recordData.leadNo || '01'}`;
                recordData.data_code = recordData.dataCode;
            }
            else {
                recordData.dataCode = 'N/A';
                recordData.data_code = 'N/A';
            }
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
        cache_1.CacheInvalidators.invalidateDashboard(req.organizationId);
        cache_1.CacheInvalidators.invalidateCampaigns(req.organizationId);
        cache_1.CacheInvalidators.invalidateMaster(req.organizationId, apiPath.toLowerCase());
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
        // Auto-populate partnerName for bankingpartners if omitted
        if (apiPath.toLowerCase() === 'bankingpartners') {
            if (!updateData.partnerName && (updateData.bank || updateData.loanType || updateData.psm)) {
                updateData.partnerName = `${updateData.bank || oldValues.bank || ''} - ${updateData.loanType || oldValues.loanType || ''} - ${updateData.psm || oldValues.psm || ''}`.trim() || 'Banking Partner';
            }
        }
        // Lead Source is permanently immutable: never overwrite original creator (unless old source was just raw campaign drive name)
        if (apiPath.toLowerCase() === 'leads') {
            const isRawCampSource = oldValues.source && (oldValues.source === oldValues.campaignName || oldValues.source === oldValues.campaign);
            if (oldValues.source && !isRawCampSource) {
                updateData.source = oldValues.source;
            }
            if (oldValues.creatorName) {
                updateData.creatorName = oldValues.creatorName;
            }
        }
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
        cache_1.CacheInvalidators.invalidateDashboard(req.organizationId);
        cache_1.CacheInvalidators.invalidateCampaigns(req.organizationId);
        cache_1.CacheInvalidators.invalidateMaster(req.organizationId, apiPath.toLowerCase());
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
        // If deleting a campaign record from the Campaigns module:
        // CASCADE DELETE all associated contacts, uploaded leads, and campaign assignments
        if (apiPath.toLowerCase() === 'campaigns') {
            const campData = record.data || {};
            const deletedCampName = (campData.campaignName || campData.name || campData.source || '').toString().trim();
            if (deletedCampName) {
                const escCampName = deletedCampName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                const campRegex = new RegExp(`^\\s*${escCampName}\\s*$`, 'i');
                // 1. Delete all assigned contacts and leads associated with this campaign
                const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: req.organizationId, apiPath: 'leads' });
                if (leadModule) {
                    await CustomRecord_1.default.deleteMany({
                        organizationId: req.organizationId,
                        moduleId: leadModule._id,
                        $or: [
                            { 'data.campaignName': campRegex },
                            { 'data.campaign': campRegex },
                            { 'data.campaign_name': campRegex },
                            { 'data.source': campRegex }
                        ]
                    });
                }
                // 2. Delete all campaign assignments for this campaign
                const assignModule = await ModuleDefinition_1.default.findOne({ organizationId: req.organizationId, apiPath: 'campaignassignments' });
                if (assignModule) {
                    await CustomRecord_1.default.deleteMany({
                        organizationId: req.organizationId,
                        moduleId: assignModule._id,
                        $or: [
                            { 'data.campaignName': campRegex },
                            { 'data.campaign': campRegex }
                        ]
                    });
                }
            }
        }
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
        cache_1.CacheInvalidators.invalidateDashboard(req.organizationId);
        cache_1.CacheInvalidators.invalidateCampaigns(req.organizationId);
        cache_1.CacheInvalidators.invalidateMaster(req.organizationId, apiPath.toLowerCase());
        cache_1.CacheInvalidators.invalidateMaster(req.organizationId, 'leads');
        cache_1.CacheInvalidators.invalidateMaster(req.organizationId, 'campaignassignments');
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
        cache_1.CacheInvalidators.invalidateDashboard(req.organizationId);
        cache_1.CacheInvalidators.invalidateCampaigns(req.organizationId);
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
