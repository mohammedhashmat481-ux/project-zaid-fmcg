import { Router, Request, Response } from 'express';
import ReportDefinition from '../models/ReportDefinition';
import ModuleDefinition from '../models/ModuleDefinition';
import { ReportBuilderService } from '../services/reportBuilder';
import { authenticate } from '../middleware/authMiddleware';
import { requireTenant } from '../middleware/tenantMiddleware';

import CustomRecord from '../models/CustomRecord';
import User from '../models/User';
import Status from '../models/Status';
import Role from '../models/Role';
import { serverCache, CacheKeys } from '../utils/cache';
import { queryPg } from '../config/postgres';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

// Campaign Daily, Monthly, Annually Matrix Report API Endpoint (Real Database Aggregation)
router.get('/campaign-matrix', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const nowMs = Date.now();
    const istNow = new Date(nowMs + 5.5 * 60 * 60 * 1000);
    const defaultMonth = String(istNow.getUTCMonth() + 1).padStart(2, '0');
    const defaultYear = String(istNow.getUTCFullYear());
    const istNowStr = `${defaultYear}-${defaultMonth}-${String(istNow.getUTCDate()).padStart(2, '0')}`;

    const {
      campaignName = 'ALL',
      month = defaultMonth,
      year = defaultYear,
      date,
      fromDate,
      toDate,
      startDate,
      endDate,
      period = 'daily',
      metric = 'callsMade',
      userId = 'ALL',
      roleId = 'ALL'
    } = req.query;

    const rawFromDate = fromDate || startDate || date;
    const rawToDate = toDate || endDate || date;

    const fromDateStr = (typeof rawFromDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawFromDate))
      ? rawFromDate
      : (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : istNowStr);

    const toDateStr = (typeof rawToDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawToDate))
      ? rawToDate
      : fromDateStr;

    const [startRangeStr, endRangeStr] = fromDateStr <= toDateStr
      ? [fromDateStr, toDateStr]
      : [toDateStr, fromDateStr];

    const isSingleDay = startRangeStr === endRangeStr;
    const [dYear, dMonth, dDay] = startRangeStr.split('-').map(Number);
    const dailyTargetDay = dDay; // 1 to 31
    const dailyTargetMonthIndex = dMonth - 1; // 0 to 11
    const dailyTargetYear = dYear;

    const selectedDateStr = isSingleDay ? startRangeStr : `${startRangeStr} to ${endRangeStr}`;

    const cacheKey = CacheKeys.campaignMatrix(
      orgId!,
      `${period}:${metric}:${campaignName}:${month}:${year}:${startRangeStr}:${endRangeStr}:${userId}:${roleId}`
    );
    const cached = serverCache.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.status(200).json(cached);
      return;
    }

    const isAllMonths = String(month).toUpperCase() === 'ALL' || String(month).toLowerCase().includes('all');
    const isAllYears = String(year).toUpperCase() === 'ALL' || String(year).toLowerCase().includes('all');
    const targetMonthIndex = isAllMonths ? -1 : (parseInt(String(month || defaultMonth), 10) - 1); // 0 to 11
    const targetYear = isAllYears ? -1 : (parseInt(String(year || defaultYear), 10) || parseInt(defaultYear, 10));

    // 1. Fetch Registered Campaigns and Modules with fast parallel queries
    const [campaignModule, assignmentModule, leadModule] = await Promise.all([
      ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'campaigns' }).lean(),
      ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'campaignassignments' }).lean(),
      ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' }).lean()
    ]);

    // Fast indexed query for registered campaign names
    let registeredCampaignNames: string[] = [];
    if (campaignModule) {
      const campRows = await queryPg(
        `SELECT DISTINCT COALESCE(data->>'campaignName', data->>'name', '') as name 
         FROM custom_records 
         WHERE organization_id = $1 AND module_id = $2`,
        [orgId, campaignModule._id || campaignModule.id]
      );
      registeredCampaignNames = campRows.map((r: any) => (r.name || '').trim()).filter(Boolean);
    }

    // Fetch Campaign Assignments with database-level campaign filtering
    let assignmentDocs: any[] = [];
    if (assignmentModule) {
      const assignModId = assignmentModule._id || assignmentModule.id;
      const assignSqlParams: any[] = [orgId, assignModId];
      let assignWhereClause = `WHERE organization_id = $1 AND module_id = $2`;
      if (campaignName && campaignName !== 'ALL') {
        assignSqlParams.push(String(campaignName).toLowerCase().trim());
        assignWhereClause += ` AND (lower(COALESCE(data->>'campaign', '')) = $3 OR lower(COALESCE(data->>'campaignName', '')) = $3)`;
      }
      const assignRows = await queryPg(
        `SELECT id as _id, 
                data->>'campaign' as campaign, 
                data->>'campaignName' as "campaignName", 
                data->>'assignedTo' as "assignedTo", 
                data->>'telecaller' as telecaller, 
                created_at as "createdAt"
         FROM custom_records
         ${assignWhereClause}`,
        assignSqlParams
      );
      assignmentDocs = assignRows.map((r: any) => ({
        _id: r._id,
        id: r._id,
        createdAt: r.createdAt,
        data: {
          campaign: r.campaign,
          campaignName: r.campaignName,
          assignedTo: r.assignedTo,
          telecaller: r.telecaller
        }
      }));
    }

    // Fast SQL Query for Leads with direct field projection & database-level campaign filter
    let leadDocs: any[] = [];
    if (leadModule) {
      const leadModId = leadModule._id || leadModule.id;
      const leadSqlParams: any[] = [orgId, leadModId];
      let leadWhereClause = `WHERE organization_id = $1 AND module_id = $2`;

      if (campaignName && campaignName !== 'ALL') {
        leadSqlParams.push(String(campaignName).toLowerCase().trim());
        leadWhereClause += ` AND (lower(COALESCE(data->>'campaign', '')) = $3 OR lower(COALESCE(data->>'campaignName', '')) = $3)`;
      }

      const leadRows = await queryPg(
        `SELECT 
           id as _id, 
           created_by as "createdBy", 
           updated_by as "updatedBy", 
           created_at as "createdAt", 
           updated_at as "updatedAt",
           data->>'campaign' as campaign,
           data->>'campaignName' as "campaignName",
           data->>'dialedAt' as "dialedAt",
           data->>'dialStatus' as "dialStatus",
           data->>'status' as status,
           data->>'callAttempts' as "callAttempts",
           data->>'assignedTo' as "assignedTo",
           data->>'source' as source,
           data->>'creatorName' as "creatorName",
           data->>'createdByName' as "createdByName",
           data->>'telecaller' as telecaller,
           data->>'isLeadCreated' as "isLeadCreated",
           data->>'leadCreated' as "leadCreated",
           data->>'dialedBy' as "dialedBy",
           data->>'callerName' as "callerName",
           data->>'lastDialedBy' as "lastDialedBy",
           data->>'hotDate' as "hotDate",
           data->>'loginDate' as "loginDate",
           data->>'approvalDate' as "approvalDate",
           data->>'disbursalDate' as "disbursalDate",
           data->>'leadCategory' as "leadCategory"
         FROM custom_records
         ${leadWhereClause}`,
        leadSqlParams
      );

      leadDocs = leadRows.map((r: any) => ({
        _id: r._id,
        id: r._id,
        createdBy: r.createdBy,
        updatedBy: r.updatedBy,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        data: {
          campaign: r.campaign,
          campaignName: r.campaignName,
          dialedAt: r.dialedAt,
          dialStatus: r.dialStatus,
          status: r.status,
          callAttempts: r.callAttempts,
          assignedTo: r.assignedTo,
          source: r.source,
          creatorName: r.creatorName,
          createdByName: r.createdByName,
          telecaller: r.telecaller,
          isLeadCreated: r.isLeadCreated === true || r.isLeadCreated === 'true',
          leadCreated: r.leadCreated === true || r.leadCreated === 'true',
          dialedBy: r.dialedBy,
          callerName: r.callerName,
          lastDialedBy: r.lastDialedBy,
          hotDate: r.hotDate,
          loginDate: r.loginDate,
          approvalDate: r.approvalDate,
          disbursalDate: r.disbursalDate,
          leadCategory: r.leadCategory
        }
      }));
    }

    // Filter by selected campaign if specified
    let filteredAssignments = assignmentDocs;
    let filteredLeads = leadDocs;

    if (campaignName && campaignName !== 'ALL') {
      const campLower = String(campaignName).toLowerCase().trim();
      filteredAssignments = assignmentDocs.filter((a: any) => {
        const c = (a.data?.campaign || a.data?.campaignName || '').toString().toLowerCase().trim();
        return c === campLower;
      });
    }

    // 2. Fetch Real Users from Organization and build strict canonical lookup
    const users = await User.find({ organizationId: orgId })
      .select('_id firstName lastName name username email roleId')
      .lean();

    const callerLookup = new Map<string, string>();
    const orderedCallersList: string[] = [];

    // Filter users if roleId or userId filter is active
    let targetUsers = users;
    if (roleId && roleId !== 'ALL') {
      targetUsers = targetUsers.filter((u: any) => String(u.roleId || '') === String(roleId));
    }
    if (userId && userId !== 'ALL') {
      targetUsers = targetUsers.filter((u: any) => String(u._id || '') === String(userId) || String(u.id || '') === String(userId));
    }

    const isFilteredByUserOrRole = (roleId && roleId !== 'ALL') || (userId && userId !== 'ALL');
    const targetUserNames = new Set<string>();

    users.forEach((u: any) => {
      const full = u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : (u.name || u.username || u.email);
      if (full && !orderedCallersList.includes(full)) {
        orderedCallersList.push(full);
      }
      const lowerFull = full.toLowerCase().trim();
      callerLookup.set(lowerFull, full);
      if (u._id) callerLookup.set(String(u._id).toLowerCase().trim(), full);
      if (u.id) callerLookup.set(String(u.id).toLowerCase().trim(), full);
      if (u.email) callerLookup.set(u.email.toLowerCase().trim(), full);
      if (u.username) callerLookup.set(u.username.toLowerCase().trim(), full);
    });

    targetUsers.forEach((u: any) => {
      const full = u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : (u.name || u.username || u.email);
      if (full) {
        targetUserNames.add(full);
      }
    });

    // Helper: Strictly resolve a lead/assignment to exactly one canonical caller/creator name
    const resolveCallerName = (item: any, metricType?: string): string | null => {
      const d = item.data || {};

      let candidateList: any[] = [];

      if (metricType === 'callsMade' || metricType === 'leadsCalled') {
        // Person who actually initiated, dialed, or created/updated the lead
        candidateList = [
          d.dialedBy,
          d.callerName,
          d.lastDialedBy,
          d.source,
          d.creatorName,
          d.createdByName,
          item.createdBy,
          item.updatedBy,
          d.telecaller,
          d.assignedTo?.name,
          d.assignedTo?.email,
          d.assignedTo?._id,
          d.assignedTo,
          item.assignedTo?.name,
          item.assignedTo
        ];
      } else if (metricType === 'hotLeads' || metricType === 'warmLeads') {
        // Person who created or sourced the hot/warm lead
        candidateList = [
          d.source,
          d.creatorName,
          d.createdByName,
          item.createdBy,
          d.dialedBy,
          d.callerName,
          item.updatedBy,
          d.assignedTo?.name,
          d.assignedTo?.email,
          d.assignedTo?._id,
          d.assignedTo,
          d.telecaller
        ];
      } else {
        // General resolution
        candidateList = [
          d.assignedTo?.name,
          d.assignedTo?.email,
          d.assignedTo?._id,
          d.assignedTo,
          d.telecaller,
          item.assignedTo?.name,
          item.assignedTo,
          d.dialedBy,
          d.callerName,
          item.updatedBy,
          item.createdBy,
          d.source,
          d.creatorName,
          d.createdByName
        ];
      }

      for (const cand of candidateList) {
        if (!cand) continue;
        const str = String(cand).trim();
        if (!str || ['unassigned', 'n/a', 'null', 'excel import', 'system', 'undefined'].includes(str.toLowerCase())) {
          continue;
        }

        const lower = str.toLowerCase();
        if (callerLookup.has(lower)) {
          return callerLookup.get(lower)!;
        }

        for (const c of orderedCallersList) {
          if (c.toLowerCase() === lower) return c;
        }

        // If not found in users table, but is a valid readable human name (not a mongo/UUID hash)
        if (!/^[0-9a-f]{24}$/i.test(str) && !/^[0-9a-f-]{36}$/i.test(str)) {
          return str;
        }
      }

      return null;
    };

    if (isFilteredByUserOrRole) {
      filteredLeads = filteredLeads.filter(l => {
        const caller = resolveCallerName(l, String(metric));
        return caller && targetUserNames.has(caller);
      });
      filteredAssignments = filteredAssignments.filter(a => {
        const caller = resolveCallerName(a, String(metric));
        return caller && targetUserNames.has(caller);
      });
    }

    let callerNames: string[] = [];
    if (isFilteredByUserOrRole) {
      callerNames = Array.from(targetUserNames);
    } else {
      callerNames = [...orderedCallersList];
      filteredLeads.forEach((l: any) => {
        const caller = resolveCallerName(l, String(metric));
        if (caller && !callerNames.includes(caller)) {
          callerNames.push(caller);
        }
      });
      filteredAssignments.forEach((a: any) => {
        const caller = resolveCallerName(a, String(metric));
        if (caller && !callerNames.includes(caller)) {
          callerNames.push(caller);
        }
      });
    }
    if (callerNames.length === 0) {
      callerNames = isFilteredByUserOrRole ? ['Selected User'] : ['Super Admin', 'Telecaller'];
    }

    // Uncalled status set
    const UNCALLED_STATUSES = new Set([
      '',
      'new',
      'yet to call',
      'not called',
      'unassigned',
      'null',
      'undefined'
    ]);

    // Helper: Determine if a lead has ACTUALLY been dialed / called,
    // or has an active dashboard lead status (e.g. Hot Leads, Warm Leads, Cool Lead, Followup, Login, Document Pending, Status Pending, Approved, Disbursed, Rejected, etc.)
    const isLeadDialed = (lead: any): boolean => {
      const d = lead.data || {};
      if (d.dialedAt) return true;
      const callAttempts = Number(d.callAttempts || 0);
      if (callAttempts > 0) return true;
      if (d.isLeadCreated || d.leadCreated) return true;

      // Campaign dial status check
      const dialSt = (d.dialStatus || '').toString().toLowerCase().trim();
      if (dialSt && !UNCALLED_STATUSES.has(dialSt)) return true;

      // Dashboard lead status check (Hot, Warm, Cool, Followup, Login, Document Pending, Status Pending, Approved, Disbursed, Rejected, etc.)
      const st = (d.status || lead.status || '').toString().toLowerCase().trim();
      if (st && !UNCALLED_STATUSES.has(st)) return true;

      const cat = (d.leadCategory || '').toString().toLowerCase().trim();
      if (cat && !UNCALLED_STATUSES.has(cat)) return true;

      return false;
    };

    // Helper: Resolve the real date of an event (in Indian Standard Time UTC+05:30)
    // NEVER uses followUpDate for calls made (followUpDate is a scheduled future date!)
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const getEventDateParts = (lead: any, metricType: string) => {
      const d = lead.data || {};
      let rawDate: any = null;

      if (metricType === 'callsMade' || metricType === 'leadsCalled') {
        rawDate = d.dialedAt || (isLeadDialed(lead) ? (d.hotDate || d.loginDate || d.approvalDate || d.disbursalDate || lead.updatedAt || lead.createdAt) : null);
      } else if (metricType === 'hotLeads') {
        rawDate = d.hotDate || lead.updatedAt || lead.createdAt;
      } else if (metricType === 'logins') {
        rawDate = d.loginDate || lead.updatedAt || lead.createdAt;
      } else if (metricType === 'approved') {
        rawDate = d.approvalDate || lead.updatedAt || lead.createdAt;
      } else if (metricType === 'disbursed') {
        rawDate = d.disbursalDate || lead.updatedAt || lead.createdAt;
      } else {
        rawDate = d.dialedAt || (isLeadDialed(lead) ? (d.hotDate || d.loginDate || d.approvalDate || d.disbursalDate || lead.updatedAt || lead.createdAt) : null);
      }

      if (!rawDate) return null;
      const dateObj = new Date(rawDate);
      const timeMs = dateObj.getTime();
      if (isNaN(timeMs)) return null;

      // Cap at current time to never project events into future days beyond today (IST)
      const currentMs = Date.now();
      const validTimeMs = timeMs > currentMs ? currentMs : timeMs;
      const istDate = new Date(validTimeMs + IST_OFFSET_MS);

      const y = istDate.getUTCFullYear();
      const m = String(istDate.getUTCMonth() + 1).padStart(2, '0');
      const dayNumStr = String(istDate.getUTCDate()).padStart(2, '0');

      return {
        year: y,
        month: istDate.getUTCMonth(), // 0 to 11
        day: istDate.getUTCDate(), // 1 to 31
        hour: istDate.getUTCHours(), // 0 to 23
        dateStr: `${y}-${m}-${dayNumStr}`
      };
    };

    // Helper to check if lead matches a metric
    const isLeadMetricMatch = (l: any, m: string): boolean => {
      const d = l.data || {};
      const st = (d.status || l.status || '').toString().toLowerCase();
      const cat = (d.leadCategory || '').toString().toLowerCase();

      if (m === 'callsMade') return isLeadDialed(l);
      if (m === 'leadsCalled') return isLeadDialed(l);
      if (m === 'hotLeads') return st.includes('hot') || cat.includes('hot');
      if (m === 'logins') return st.includes('login') || st.includes('document') || st.includes('cebil') || st.includes('approval pending') || !!d.loginDate || !!d.loginAmount;
      if (m === 'approved') return (st.includes('approv') && !st.includes('pending')) || st.includes('approved but not disbuse') || st === 'approved';
      if (m === 'disbursed') return st.includes('disbus') || st.includes('disburs') || st.includes('closed won');
      if (m === 'yetToCall') return !isLeadDialed(l);
      return true; // assigned, all
    };

    // 4. Generate Columns based on Period
    const HOURLY_COLUMNS = [
      '09:00 AM',
      '10:00 AM',
      '11:00 AM',
      '12:00 PM',
      '01:00 PM',
      '02:00 PM',
      '03:00 PM',
      '04:00 PM',
      '05:00 PM',
      '06:00 PM',
      '07:00 PM',
      '08:00 PM'
    ];

    // Build day range list if multiple days
    const rangeDays: { dateStr: string; label: string }[] = [];
    if (!isSingleDay) {
      const cur = new Date(startRangeStr + 'T00:00:00Z');
      const end = new Date(endRangeStr + 'T00:00:00Z');
      while (cur <= end && rangeDays.length < 90) {
        const y = cur.getUTCFullYear();
        const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
        const d = String(cur.getUTCDate()).padStart(2, '0');
        const dStr = `${y}-${m}-${d}`;
        const label = cur.toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' });
        rangeDays.push({ dateStr: dStr, label });
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    let columns: string[] = [];
    if (period === 'daily') {
      columns = isSingleDay ? HOURLY_COLUMNS : rangeDays.map(d => d.label);
    } else if (period === 'monthly') {
      const daysInMonth = (isAllMonths || isAllYears) ? 31 : new Date(targetYear, targetMonthIndex + 1, 0).getDate();
      columns = Array.from({ length: daysInMonth }, (_, i) => `Day ${String(i + 1).padStart(2, '0')}`);
    } else {
      columns = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    }

    // 5. Pre-bucket leads by canonical caller so EACH lead belongs to EXACTLY ONE caller
    const callerLeadsMap = new Map<string, any[]>();
    const callerAssignsMap = new Map<string, any[]>();
    callerNames.forEach(c => {
      callerLeadsMap.set(c, []);
      callerAssignsMap.set(c, []);
    });

    filteredLeads.forEach(l => {
      const caller = resolveCallerName(l, String(metric));
      if (caller && callerLeadsMap.has(caller)) {
        callerLeadsMap.get(caller)!.push(l);
      }
    });

    filteredAssignments.forEach(a => {
      const caller = resolveCallerName(a, String(metric));
      if (caller && callerAssignsMap.has(caller)) {
        callerAssignsMap.get(caller)!.push(a);
      }
    });

    // 6. Generate caller matrix rows for selected metric
    const rows = callerNames.map(callerName => {
      const userLeads = callerLeadsMap.get(callerName) || [];
      const userAssigns = callerAssignsMap.get(callerName) || [];
      const userDialed = userLeads.filter(isLeadDialed);

      const relevantLeads = userLeads.filter(l => isLeadMetricMatch(l, String(metric)));

      // Bucket relevant leads by interval
      const leadsByHour: Record<string, any[]> = {};
      const leadsByRangeDay: Record<string, any[]> = {};
      const leadsByDay: Record<number, any[]> = {};
      const leadsByMonth: Record<number, any[]> = {};

      HOURLY_COLUMNS.forEach(col => { leadsByHour[col] = []; });
      rangeDays.forEach(d => { leadsByRangeDay[d.label] = []; });

      relevantLeads.forEach(l => {
        const parts = getEventDateParts(l, String(metric));
        if (parts) {
          if (isSingleDay) {
            // Strictly single date for daily
            if (parts.year === dailyTargetYear && parts.month === dailyTargetMonthIndex && parts.day === dailyTargetDay) {
              let colName = '09:00 AM';
              if (parts.hour <= 9) colName = '09:00 AM';
              else if (parts.hour === 10) colName = '10:00 AM';
              else if (parts.hour === 11) colName = '11:00 AM';
              else if (parts.hour === 12) colName = '12:00 PM';
              else if (parts.hour === 13) colName = '01:00 PM';
              else if (parts.hour === 14) colName = '02:00 PM';
              else if (parts.hour === 15) colName = '03:00 PM';
              else if (parts.hour === 16) colName = '04:00 PM';
              else if (parts.hour === 17) colName = '05:00 PM';
              else if (parts.hour === 18) colName = '06:00 PM';
              else if (parts.hour === 19) colName = '07:00 PM';
              else colName = '08:00 PM';

              leadsByHour[colName].push(l);
            }
          } else {
            // Multi-day date range
            if (parts.dateStr >= startRangeStr && parts.dateStr <= endRangeStr) {
              const matchedDay = rangeDays.find(rd => rd.dateStr === parts.dateStr);
              if (matchedDay && leadsByRangeDay[matchedDay.label]) {
                leadsByRangeDay[matchedDay.label].push(l);
              }
            }
          }

          const monthMatch = isAllMonths || parts.month === targetMonthIndex;
          const yearMatch = isAllYears || parts.year === targetYear;

          if (monthMatch && yearMatch) {
            if (!leadsByDay[parts.day]) leadsByDay[parts.day] = [];
            leadsByDay[parts.day].push(l);
          }
          if (yearMatch) {
            if (!leadsByMonth[parts.month]) leadsByMonth[parts.month] = [];
            leadsByMonth[parts.month].push(l);
          }
        }
      });

      const rowData: Record<string, number> = {};
      let rowTotal = 0;

      columns.forEach((col, cIdx) => {
        let val = 0;

        if (period === 'daily') {
          if (isSingleDay) {
            const hourLeads = leadsByHour[col] || [];
            if (metric === 'callsMade' || metric === 'leadsCalled') {
              val = hourLeads.length;
            } else if (metric === 'targetAchievement' || metric === 'progressPct') {
              val = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
            } else if (metric === 'yetToCall') {
              val = hourLeads.filter(l => !isLeadDialed(l)).length;
            } else if (metric === 'campaignsAssigned') {
              val = userAssigns.length > 0 ? 1 : 0;
            } else {
              val = hourLeads.length;
            }
          } else {
            const dayLeads = leadsByRangeDay[col] || [];
            if (metric === 'callsMade' || metric === 'leadsCalled') {
              val = dayLeads.length;
            } else if (metric === 'targetAchievement' || metric === 'progressPct') {
              val = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
            } else if (metric === 'yetToCall') {
              val = dayLeads.filter(l => !isLeadDialed(l)).length;
            } else if (metric === 'campaignsAssigned') {
              val = userAssigns.length > 0 ? 1 : 0;
            } else {
              val = dayLeads.length;
            }
          }
        } else if (period === 'monthly') {
          const dayNum = cIdx + 1; // 1 to 31
          const dayLeads = leadsByDay[dayNum] || [];

          if (metric === 'callsMade' || metric === 'leadsCalled') {
            val = dayLeads.length;
          } else if (metric === 'targetAchievement' || metric === 'progressPct') {
            val = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
          } else if (metric === 'yetToCall') {
            val = dayLeads.filter(l => !isLeadDialed(l)).length;
          } else if (metric === 'campaignsAssigned') {
            val = userAssigns.length > 0 ? 1 : 0;
          } else {
            val = dayLeads.length;
          }
        } else {
          // Annually
          const monthLeads = leadsByMonth[cIdx] || [];

          if (metric === 'callsMade' || metric === 'leadsCalled') {
            val = monthLeads.length;
          } else if (metric === 'targetAchievement' || metric === 'progressPct') {
            val = userLeads.length > 0 ? Math.round((userDialed.length / userLeads.length) * 100) : 0;
          } else if (metric === 'yetToCall') {
            val = monthLeads.filter(l => !isLeadDialed(l)).length;
          } else if (metric === 'campaignsAssigned') {
            val = userAssigns.length > 0 ? 1 : 0;
          } else {
            val = monthLeads.length;
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
    const totals: Record<string, number> = {};
    let grandTotal = 0;
    columns.forEach(col => {
      const sum = rows.reduce((acc, r) => acc + (r.data[col] || 0), 0);
      if (metric === 'targetAchievement' || metric === 'progressPct') {
        totals[col] = rows.length > 0 ? Math.round(sum / rows.length) : 0;
      } else {
        totals[col] = sum;
        grandTotal += sum;
      }
    });

    // 8. Compute KPI Hero Summary cards strictly scoped to the active period
    const isLeadInPeriod = (l: any, mKey: string): boolean => {
      const parts = getEventDateParts(l, mKey);
      if (!parts) return false;
      if (period === 'daily') {
        if (isSingleDay) {
          return parts.year === dailyTargetYear && parts.month === dailyTargetMonthIndex && parts.day === dailyTargetDay;
        } else {
          return parts.dateStr >= startRangeStr && parts.dateStr <= endRangeStr;
        }
      }
      const monthMatch = isAllMonths || parts.month === targetMonthIndex;
      const yearMatch = isAllYears || parts.year === targetYear;
      if (period === 'monthly') return monthMatch && yearMatch;
      if (period === 'annually') return yearMatch;
      return true;
    };

    const periodDialedLeads = filteredLeads.filter(l => isLeadDialed(l) && isLeadInPeriod(l, 'callsMade'));
    const periodCallsMade = periodDialedLeads.length;
    const periodHotLeads = filteredLeads.filter(l => isLeadMetricMatch(l, 'hotLeads') && isLeadInPeriod(l, 'hotLeads')).length;
    const periodLogins = filteredLeads.filter(l => isLeadMetricMatch(l, 'logins') && isLeadInPeriod(l, 'logins')).length;
    const periodApproved = filteredLeads.filter(l => isLeadMetricMatch(l, 'approved') && isLeadInPeriod(l, 'approved')).length;
    const periodDisbursed = filteredLeads.filter(l => isLeadMetricMatch(l, 'disbursed') && isLeadInPeriod(l, 'disbursed')).length;

    const totalLeadsAssignedCount = Math.max(
      filteredAssignments.length,
      filteredLeads.length
    );
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
      selectedDate: selectedDateStr,
      fromDate: startRangeStr,
      toDate: endRangeStr,
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

    serverCache.set(cacheKey, responsePayload, 60);
    res.setHeader('X-Cache', 'MISS');
    res.status(200).json(responsePayload);
  } catch (error: any) {
    console.error('Campaign matrix aggregation error:', error);
    res.status(500).json({ error: error.message || 'Failed to aggregate campaign report data' });
  }
});

// =========================================================================
// REAL-TIME CRM FUNNEL ANALYTICS API (Comprehensive, Real Database Aggregated)
// =========================================================================
router.get('/funnel-analytics', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    if (!orgId) {
      res.status(400).json({ error: 'Organization ID missing' });
      return;
    }

    // 1. Resolve Indian Standard Time (IST UTC+5:30)
    const nowMs = Date.now();
    const istNow = new Date(nowMs + 5.5 * 60 * 60 * 1000);
    const curYear = istNow.getUTCFullYear();
    const curMonth = istNow.getUTCMonth(); // 0 to 11
    const curDate = istNow.getUTCDate();
    const istNowStr = `${curYear}-${String(curMonth + 1).padStart(2, '0')}-${String(curDate).padStart(2, '0')}`;

    const {
      period = 'daily',
      datePreset,
      date,
      month,
      year,
      startDate,
      endDate,
      campaign = 'ALL',
      agent = 'ALL',
      stage = 'ALL',
      search = '',
      page = '1',
      limit = '25'
    } = req.query;

    const isExport = req.query.export === 'true' || req.query.all === 'true';
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = isExport ? 50000 : Math.max(1, Math.min(500, parseInt(String(limit), 10) || 25));

    // 2. Resolve Active Date Range & Comparison (Previous) Period Range
    let startRangeStr = istNowStr;
    let endRangeStr = istNowStr;
    let prevStartRangeStr = istNowStr;
    let prevEndRangeStr = istNowStr;
    let effectivePreset = String(datePreset || '').toLowerCase().trim();

    const formatDateStr = (d: Date): string => {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    };

    if (effectivePreset === 'today' || (period === 'daily' && !effectivePreset && !startDate)) {
      effectivePreset = 'today';
      const targetDate = (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) ? String(date) : istNowStr;
      startRangeStr = targetDate;
      endRangeStr = targetDate;

      const [y, m, d] = targetDate.split('-').map(Number);
      const prevD = new Date(Date.UTC(y, m - 1, d - 1));
      prevStartRangeStr = formatDateStr(prevD);
      prevEndRangeStr = prevStartRangeStr;
    } else if (effectivePreset === 'yesterday') {
      const yesterday = new Date(Date.UTC(curYear, curMonth, curDate - 1));
      startRangeStr = formatDateStr(yesterday);
      endRangeStr = startRangeStr;

      const dayBefore = new Date(Date.UTC(curYear, curMonth, curDate - 2));
      prevStartRangeStr = formatDateStr(dayBefore);
      prevEndRangeStr = prevStartRangeStr;
    } else if (effectivePreset === 'this_week') {
      const dayOfWeek = istNow.getUTCDay(); // 0 is Sun, 1 is Mon...
      const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monDate = new Date(Date.UTC(curYear, curMonth, curDate + diffToMon));
      startRangeStr = formatDateStr(monDate);
      endRangeStr = istNowStr;

      const prevMon = new Date(Date.UTC(curYear, curMonth, curDate + diffToMon - 7));
      const prevSun = new Date(Date.UTC(curYear, curMonth, curDate + diffToMon - 1));
      prevStartRangeStr = formatDateStr(prevMon);
      prevEndRangeStr = formatDateStr(prevSun);
    } else if (effectivePreset === 'this_month' || (period === 'monthly' && !effectivePreset && !startDate)) {
      effectivePreset = 'this_month';
      const targetMonth = month ? (parseInt(String(month), 10) - 1) : curMonth;
      const targetYear = year ? parseInt(String(year), 10) : curYear;

      const firstDay = new Date(Date.UTC(targetYear, targetMonth, 1));
      const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0));
      startRangeStr = formatDateStr(firstDay);
      endRangeStr = formatDateStr(lastDay);

      const prevMonthFirst = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
      const prevMonthLast = new Date(Date.UTC(targetYear, targetMonth, 0));
      prevStartRangeStr = formatDateStr(prevMonthFirst);
      prevEndRangeStr = formatDateStr(prevMonthLast);
    } else if (effectivePreset === 'last_month') {
      const prevMonthFirst = new Date(Date.UTC(curYear, curMonth - 1, 1));
      const prevMonthLast = new Date(Date.UTC(curYear, curMonth, 0));
      startRangeStr = formatDateStr(prevMonthFirst);
      endRangeStr = formatDateStr(prevMonthLast);

      const monthBeforeFirst = new Date(Date.UTC(curYear, curMonth - 2, 1));
      const monthBeforeLast = new Date(Date.UTC(curYear, curMonth - 1, 0));
      prevStartRangeStr = formatDateStr(monthBeforeFirst);
      prevEndRangeStr = formatDateStr(monthBeforeLast);
    } else if (effectivePreset === 'this_year' || (period === 'annual' && !effectivePreset && !startDate)) {
      effectivePreset = 'this_year';
      const targetYear = year ? parseInt(String(year), 10) : curYear;
      startRangeStr = `${targetYear}-01-01`;
      endRangeStr = `${targetYear}-12-31`;

      prevStartRangeStr = `${targetYear - 1}-01-01`;
      prevEndRangeStr = `${targetYear - 1}-12-31`;
    } else if (effectivePreset === 'last_year') {
      const prevYear = curYear - 1;
      startRangeStr = `${prevYear}-01-01`;
      endRangeStr = `${prevYear}-12-31`;

      prevStartRangeStr = `${prevYear - 1}-01-01`;
      prevEndRangeStr = `${prevYear - 1}-12-31`;
    } else if (startDate && endDate) {
      effectivePreset = 'custom';
      startRangeStr = String(startDate);
      endRangeStr = String(endDate);

      const diffDays = Math.max(1, Math.round((new Date(endRangeStr).getTime() - new Date(startRangeStr).getTime()) / (24 * 3600 * 1000))) + 1;
      const s = new Date(startRangeStr);
      const prevEnd = new Date(s.getTime() - 24 * 3600 * 1000);
      const prevStart = new Date(prevEnd.getTime() - (diffDays - 1) * 24 * 3600 * 1000);
      prevStartRangeStr = formatDateStr(new Date(Date.UTC(prevStart.getUTCFullYear(), prevStart.getUTCMonth(), prevStart.getUTCDate())));
      prevEndRangeStr = formatDateStr(new Date(Date.UTC(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), prevEnd.getUTCDate())));
    }

    // 3. Fetch Lead Module & Statuses from DB
    const [leadModule, campaignModule, dbStatusesRaw] = await Promise.all([
      ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' }).lean(),
      ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'campaigns' }).lean(),
      Status.find({ organizationId: orgId }).sort({ order: 1 }).lean()
    ]);

    if (!leadModule) {
      res.status(404).json({ error: 'Leads module not found' });
      return;
    }

    const leadModId = leadModule._id || leadModule.id;

    const defaultStatusesFallback = [
      { name: 'HOT LEADS', color: '#EF4444', icon: 'Flame', isSuccess: false, isFinal: false, order: 1 },
      { name: 'WARM LEADS', color: '#F59E0B', icon: 'Sun', isSuccess: false, isFinal: false, order: 2 },
      { name: 'COOL LEAD', color: '#06B6D4', icon: 'Snowflake', isSuccess: false, isFinal: false, order: 3 },
      { name: 'DOCUMENT PENDING', color: '#14B8A6', icon: 'FileText', isSuccess: false, isFinal: false, order: 4 },
      { name: 'STATUS PENDING', color: '#F97316', icon: 'Clock', isSuccess: false, isFinal: false, order: 5 },
      { name: 'APPROVED', color: '#10B981', icon: 'CheckCircle', isSuccess: true, isFinal: false, order: 6 },
      { name: 'DISBUSED', color: '#059669', icon: 'Banknote', isSuccess: true, isFinal: true, order: 7 },
      { name: 'REJECTED', color: '#DC2626', icon: 'XOctagon', isSuccess: false, isFinal: true, order: 8 },
      { name: 'FOLLOWUP', color: '#3B82F6', icon: 'PhoneCall', isSuccess: false, isFinal: false, order: 9 },
      { name: 'DROPPED', color: '#E11D48', icon: 'ArrowDownCircle', isSuccess: false, isFinal: true, order: 10 }
    ];

    const dbStatuses = (dbStatusesRaw && dbStatusesRaw.length > 0) ? dbStatusesRaw : defaultStatusesFallback;

    const statusMap = new Map<string, any>();
    dbStatuses.forEach((s: any) => {
      statusMap.set(s.name.toUpperCase().trim(), s);
    });

    const isLeadWon = (st: string): boolean => {
      const clean = (st || '').toUpperCase().trim();
      const obj = statusMap.get(clean);
      if (obj && obj.isSuccess) return true;
      return /(APPROVED|DISBUSED|DISBURSED|WON|CLOSED WON)/i.test(clean);
    };

    const isLeadLost = (st: string): boolean => {
      const clean = (st || '').toUpperCase().trim();
      const obj = statusMap.get(clean);
      if (obj && obj.isFinal && !obj.isSuccess) return true;
      return /(REJECTED|DROPPED|LOST|DEAD|CLOSED FINAL|CLOSED LOST|NOT INTERESTED)/i.test(clean);
    };

    // 4. Query Registered Campaigns for Filter Dropdown
    let registeredCampaigns: string[] = [];
    if (campaignModule) {
      const campRows = await queryPg(
        `SELECT DISTINCT COALESCE(data->>'campaignName', data->>'name', '') as name 
         FROM custom_records 
         WHERE organization_id = $1 AND module_id = $2`,
        [orgId, campaignModule._id || campaignModule.id]
      );
      registeredCampaigns = campRows.map((r: any) => (r.name || '').trim()).filter(Boolean);
    }

    // 5. Query Leads for Current Selected Date Range
    let whereClause = `WHERE organization_id = $1 AND module_id = $2`;
    const params: any[] = [orgId, leadModId, startRangeStr, endRangeStr];
    whereClause += ` AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $3::date AND $4::date`;

    let pIdx = 5;
    if (campaign && campaign !== 'ALL') {
      params.push(String(campaign).toLowerCase().trim());
      whereClause += ` AND (lower(COALESCE(data->>'campaign', data->>'campaignName', '')) = $${pIdx})`;
      pIdx++;
    }

    if (agent && agent !== 'ALL') {
      params.push(String(agent).toLowerCase().trim());
      whereClause += ` AND (
        lower(COALESCE(data->>'assignedTo', '')) = $${pIdx} OR 
        lower(COALESCE(data->>'assignedToName', '')) = $${pIdx} OR 
        lower(COALESCE(data->>'source', '')) = $${pIdx} OR 
        lower(COALESCE(data->>'creatorName', '')) = $${pIdx} OR 
        lower(COALESCE(data->>'telecaller', '')) = $${pIdx}
      )`;
      pIdx++;
    }

    // Non-admin user RBAC isolation
    const authUser = req.user as any;
    if (authUser) {
      let roleName = '';
      if (authUser.role?.name) {
        roleName = authUser.role.name;
      } else if (authUser.roleId) {
        const rDoc = await Role.findById(authUser.roleId).lean();
        if (rDoc) roleName = (rDoc as any).name || '';
      }
      if (roleName && !['super admin', 'admin', 'administrator', 'director', 'general manager'].includes(roleName.toLowerCase())) {
        const userFullName = [authUser.firstName, authUser.lastName].filter(Boolean).join(' ') || authUser.name || authUser.email?.split('@')[0] || '';
        params.push(String(authUser.id));
        params.push(userFullName.toLowerCase());
        whereClause += ` AND (
          data->>'assignedTo' = $${pIdx} OR 
          lower(COALESCE(data->>'assignedToName', '')) = $${pIdx + 1} OR 
          lower(COALESCE(data->>'source', '')) = $${pIdx + 1} OR 
          lower(COALESCE(data->>'creatorName', '')) = $${pIdx + 1} OR 
          created_by = $${pIdx}
        )`;
        pIdx += 2;
      }
    }

    const leadRows = await queryPg(
      `SELECT 
         id as _id,
         created_at as "createdAt",
         updated_at as "updatedAt",
         (created_at AT TIME ZONE 'Asia/Kolkata')::date as "leadDate",
         to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'HH24:00') as "leadHour",
         data->>'leadNo' as "leadNo",
         COALESCE(data->>'customerName', data->>'fullName', trim(concat(COALESCE(data->>'firstName',''), ' ', COALESCE(data->>'lastName','')))) as "customerName",
         COALESCE(data->>'company', data->>'companyName', data->>'firmName') as "companyName",
         COALESCE(data->>'phone', data->>'mobile', data->>'contactNumber') as "mobile",
         COALESCE(data->>'email', data->>'eMail') as "email",
         COALESCE(data->>'status', data->>'dialStatus', 'HOT LEADS') as "status",
         COALESCE(data->>'loanType', data->>'product', '') as "loanType",
         COALESCE(data->>'loanAmount', data->>'budget', data->>'amount', '') as "loanAmount",
         COALESCE(data->>'businessPartner', data->>'bankPartner', data->>'bank', '') as "bankPartner",
         COALESCE(data->>'assignedToName', data->>'assignedTo', data->>'telecaller', '') as "assignedTo",
         COALESCE(data->>'source', data->>'creatorName', data->>'createdByName', '') as "source",
         COALESCE(data->>'followUpDate', data->>'followupDate', '') as "followUpDate",
         COALESCE(data->>'campaign', data->>'campaignName', '') as "campaignName"
       FROM custom_records
       ${whereClause}
       ORDER BY created_at DESC`,
      params
    );

    // 6. Query Previous Period for Real Historical Comparisons
    let prevWhereClause = `WHERE organization_id = $1 AND module_id = $2`;
    const prevParams: any[] = [orgId, leadModId, prevStartRangeStr, prevEndRangeStr];
    prevWhereClause += ` AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $3::date AND $4::date`;

    let prevPIdx = 5;
    if (campaign && campaign !== 'ALL') {
      prevParams.push(String(campaign).toLowerCase().trim());
      prevWhereClause += ` AND (lower(COALESCE(data->>'campaign', data->>'campaignName', '')) = $${prevPIdx})`;
      prevPIdx++;
    }
    if (agent && agent !== 'ALL') {
      prevParams.push(String(agent).toLowerCase().trim());
      prevWhereClause += ` AND (
        lower(COALESCE(data->>'assignedTo', '')) = $${prevPIdx} OR 
        lower(COALESCE(data->>'assignedToName', '')) = $${prevPIdx} OR 
        lower(COALESCE(data->>'source', '')) = $${prevPIdx} OR 
        lower(COALESCE(data->>'creatorName', '')) = $${prevPIdx} OR 
        lower(COALESCE(data->>'telecaller', '')) = $${prevPIdx}
      )`;
      prevPIdx++;
    }

    const prevRows = await queryPg(
      `SELECT id, COALESCE(data->>'status', data->>'dialStatus', '') as status 
       FROM custom_records 
       ${prevWhereClause}`,
      prevParams
    );

    // 7. Aggregate Summary Metrics
    const totalLeads = leadRows.length;
    let convertedLeads = 0;
    let lostLeads = 0;
    const stageCountMap: Record<string, number> = {};

    leadRows.forEach((r: any) => {
      const st = (r.status || 'HOT LEADS').toUpperCase().trim();
      stageCountMap[st] = (stageCountMap[st] || 0) + 1;
      if (isLeadWon(st)) {
        convertedLeads++;
      } else if (isLeadLost(st)) {
        lostLeads++;
      }
    });

    const activeLeads = Math.max(0, totalLeads - convertedLeads - lostLeads);
    const overallConversionRate = totalLeads > 0 ? Number(((convertedLeads / totalLeads) * 100).toFixed(1)) : 0;

    const prevTotalLeads = prevRows.length;
    let prevConvertedLeads = 0;
    prevRows.forEach((r: any) => {
      if (isLeadWon(r.status)) prevConvertedLeads++;
    });
    const prevConversionRate = prevTotalLeads > 0 ? Number(((prevConvertedLeads / prevTotalLeads) * 100).toFixed(1)) : 0;
    const leadGrowthPct = prevTotalLeads > 0 
      ? Number((((totalLeads - prevTotalLeads) / prevTotalLeads) * 100).toFixed(1))
      : (totalLeads > 0 ? 100 : 0);
    const conversionRateDiff = Number((overallConversionRate - prevConversionRate).toFixed(1));

    // 8. Pipeline Stages Computation (Funnel)
    const funnelStages = dbStatuses.map((stObj: any, idx: number) => {
      const stName = stObj.name.toUpperCase().trim();
      const count = stageCountMap[stName] || 0;
      const pctOfTotal = totalLeads > 0 ? Number(((count / totalLeads) * 100).toFixed(1)) : 0;

      let progressionRate = 100;
      if (idx > 0) {
        const prevCount = stageCountMap[dbStatuses[idx - 1].name.toUpperCase().trim()] || 0;
        progressionRate = prevCount > 0 ? Number(Math.min(100, (count / prevCount) * 100).toFixed(1)) : (count > 0 ? 100 : 0);
      }
      const dropOffRate = Number((100 - progressionRate).toFixed(1));

      return {
        id: stObj._id || stObj.id || `stage-${idx}`,
        name: stObj.name,
        color: stObj.color || '#3B82F6',
        icon: stObj.icon || 'Filter',
        order: stObj.order || idx + 1,
        count,
        percentage: pctOfTotal,
        progressionRate,
        dropOffRate,
        isSuccess: Boolean(stObj.isSuccess),
        isFinal: Boolean(stObj.isFinal)
      };
    });

    // 9. Stage Distribution Breakdown (for Charts)
    const stageDistribution = funnelStages
      .filter((s: any) => s.count > 0)
      .map((s: any) => ({
        name: s.name,
        count: s.count,
        color: s.color,
        percentage: s.percentage
      }));

    // 10. Time-Series Trends Data
    let trends: any[] = [];
    if (period === 'daily' || effectivePreset === 'today' || effectivePreset === 'yesterday') {
      const hours = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];
      const hourMap: Record<string, { leads: number; converted: number; lost: number }> = {};
      hours.forEach(h => { hourMap[h] = { leads: 0, converted: 0, lost: 0 }; });

      leadRows.forEach((r: any) => {
        const h = r.leadHour || '10:00';
        if (!hourMap[h]) {
          hourMap[h] = { leads: 0, converted: 0, lost: 0 };
        }
        hourMap[h].leads++;
        if (isLeadWon(r.status)) hourMap[h].converted++;
        if (isLeadLost(r.status)) hourMap[h].lost++;
      });

      trends = Object.keys(hourMap).sort().map(h => ({
        label: h,
        Total: hourMap[h].leads,
        Converted: hourMap[h].converted,
        Lost: hourMap[h].lost
      }));
    } else if (period === 'annual' || effectivePreset === 'this_year' || effectivePreset === 'last_year') {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthMap: Record<number, { leads: number; converted: number; lost: number }> = {};
      for (let i = 0; i < 12; i++) monthMap[i] = { leads: 0, converted: 0, lost: 0 };

      leadRows.forEach((r: any) => {
        const d = new Date(r.createdAt);
        const m = d.getUTCMonth();
        monthMap[m].leads++;
        if (isLeadWon(r.status)) monthMap[m].converted++;
        if (isLeadLost(r.status)) monthMap[m].lost++;
      });

      trends = monthNames.map((name, idx) => ({
        label: name,
        Total: monthMap[idx].leads,
        Converted: monthMap[idx].converted,
        Lost: monthMap[idx].lost
      }));
    } else {
      const dateMap: Record<string, { leads: number; converted: number; lost: number }> = {};
      leadRows.forEach((r: any) => {
        const d = r.leadDate || formatDateStr(new Date(r.createdAt));
        if (!dateMap[d]) {
          dateMap[d] = { leads: 0, converted: 0, lost: 0 };
        }
        dateMap[d].leads++;
        if (isLeadWon(r.status)) dateMap[d].converted++;
        if (isLeadLost(r.status)) dateMap[d].lost++;
      });

      trends = Object.keys(dateMap).sort().map(d => {
        const parts = String(d).split('-');
        const shortLabel = parts.length === 3 ? `${parts[2]}/${parts[1]}` : String(d);
        return {
          label: shortLabel,
          date: d,
          Total: dateMap[d].leads,
          Converted: dateMap[d].converted,
          Lost: dateMap[d].lost
        };
      });
    }

    // 11. Drill-down Stage Leads Filtering & Pagination
    let filteredDrilldown = leadRows;
    if (stage && stage !== 'ALL') {
      const stageClean = String(stage).toUpperCase().trim();
      filteredDrilldown = filteredDrilldown.filter((r: any) => (r.status || '').toUpperCase().trim() === stageClean);
    }

    if (search && String(search).trim()) {
      const q = String(search).toLowerCase().trim();
      filteredDrilldown = filteredDrilldown.filter((r: any) => {
        return (
          (r.customerName || '').toLowerCase().includes(q) ||
          (r.companyName || '').toLowerCase().includes(q) ||
          (r.mobile || '').toLowerCase().includes(q) ||
          (r.email || '').toLowerCase().includes(q) ||
          (r.leadNo || '').toLowerCase().includes(q) ||
          (r.assignedTo || '').toLowerCase().includes(q) ||
          (r.bankPartner || '').toLowerCase().includes(q) ||
          (r.loanType || '').toLowerCase().includes(q)
        );
      });
    }

    const totalDrilldownCount = filteredDrilldown.length;
    const totalPages = Math.ceil(totalDrilldownCount / limitNum) || 1;
    const pagedLeads = filteredDrilldown.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    const responsePayload = {
      period,
      datePreset: effectivePreset,
      dateRange: {
        startDate: startRangeStr,
        endDate: endRangeStr,
        formatted: startRangeStr === endRangeStr ? startRangeStr : `${startRangeStr} to ${endRangeStr}`
      },
      previousDateRange: {
        startDate: prevStartRangeStr,
        endDate: prevEndRangeStr,
        formatted: prevStartRangeStr === prevEndRangeStr ? prevStartRangeStr : `${prevStartRangeStr} to ${prevEndRangeStr}`
      },
      summary: {
        totalLeads,
        newLeads: totalLeads,
        activeLeads,
        convertedLeads,
        lostLeads,
        overallConversionRate,
        comparison: {
          previousTotalLeads: prevTotalLeads,
          previousConvertedLeads: prevConvertedLeads,
          previousConversionRate: prevConversionRate,
          leadGrowthPct,
          conversionRateDiff
        }
      },
      funnelStages,
      stageDistribution,
      trends,
      campaignsList: registeredCampaigns,
      drilldown: {
        total: totalDrilldownCount,
        page: pageNum,
        limit: limitNum,
        totalPages,
        selectedStage: stage,
        leads: pagedLeads
      }
    };

    res.status(200).json(responsePayload);
  } catch (error: any) {
    console.error('Funnel analytics aggregation error:', error);
    res.status(500).json({ error: error.message || 'Failed to aggregate funnel analytics data' });
  }
});

// Live Telecaller Performance Report (Real Database Aggregation across Leads, Assignments & Dialing Statuses)
router.get('/telecaller-performance', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const {
      month = 'ALL',
      year = '2026',
      campaign = 'ALL',
      role = 'ALL',
      agent = 'ALL'
    } = req.query;

    // 1. Fetch Users, Roles, and Modules in Parallel
    const [users, roles, leadModule, assignModule, campModule] = await Promise.all([
      User.find({ organizationId: orgId }).select('_id id firstName lastName name email roleId').lean(),
      Role.find({ organizationId: orgId }).select('_id id name').lean(),
      ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' }).lean(),
      ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'campaignassignments' }).lean(),
      ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'campaigns' }).lean()
    ]);

    const roleMap = new Map<string, string>();
    roles.forEach((r: any) => {
      roleMap.set(String(r._id || r.id), r.name);
    });

    // 2. Fetch distinct campaigns from campaigns module
    let registeredCampaigns: string[] = [];
    if (campModule) {
      const campRows = await queryPg(
        `SELECT DISTINCT COALESCE(data->>'campaignName', data->>'name', '') as name 
         FROM custom_records 
         WHERE organization_id = $1 AND module_id = $2`,
        [orgId, campModule._id || campModule.id]
      );
      registeredCampaigns = campRows.map((r: any) => (r.name || '').trim()).filter(Boolean);
    }

    if (!leadModule) {
      res.status(200).json({
        summary: { totalActiveTelecallers: 0, totalCallsConnected: 0, totalAssignedLeads: 0, totalFollowups: 0, connectionRate: 0 },
        agents: [],
        campaignsList: registeredCampaigns,
        rolesList: roles.map((r: any) => r.name)
      });
      return;
    }

    const leadModId = leadModule._id || leadModule.id;

    // 3. Build Leads SQL Query with Month, Year, and Campaign filters
    let leadWhere = `WHERE organization_id = $1 AND module_id = $2`;
    const leadParams: any[] = [orgId, leadModId];
    let pIdx = 3;

    if (campaign && campaign !== 'ALL') {
      const camps = Array.isArray(campaign) ? campaign : [campaign];
      const validCamps = camps.map(c => String(c).toLowerCase().trim()).filter(c => c && c !== 'all');
      if (validCamps.length > 0) {
        leadParams.push(validCamps);
        leadWhere += ` AND lower(COALESCE(data->>'campaign', data->>'campaignName', '')) = ANY($${pIdx}::text[])`;
        pIdx++;
      }
    }

    if (year && year !== 'ALL') {
      const targetYear = parseInt(String(year), 10);
      if (!isNaN(targetYear)) {
        leadParams.push(targetYear);
        leadWhere += ` AND EXTRACT(YEAR FROM (created_at AT TIME ZONE 'Asia/Kolkata')) = $${pIdx}`;
        pIdx++;
      }
    }

    if (month && month !== 'ALL') {
      const monthNames = [
        'january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december'
      ];
      const monthsArr = Array.isArray(month) ? month : [month];
      const monthIndices: number[] = [];
      monthsArr.forEach(m => {
        const str = String(m).toLowerCase().trim();
        const num = parseInt(str, 10);
        if (!isNaN(num) && num >= 1 && num <= 12) {
          monthIndices.push(num);
        } else {
          const idx = monthNames.indexOf(str);
          if (idx !== -1) monthIndices.push(idx + 1);
        }
      });
      if (monthIndices.length > 0) {
        leadParams.push(monthIndices);
        leadWhere += ` AND EXTRACT(MONTH FROM (created_at AT TIME ZONE 'Asia/Kolkata')) = ANY($${pIdx}::int[])`;
        pIdx++;
      }
    }

    // Fast indexed query
    const leadRows = await queryPg(
      `SELECT 
         id,
         created_by as "createdBy",
         COALESCE(data->>'status', data->>'dialStatus', '') as status,
         COALESCE(data->>'dialStatus', '') as "dialStatus",
         COALESCE(data->>'assignedTo', '') as "assignedTo",
         COALESCE(data->>'assignedToName', '') as "assignedToName",
         COALESCE(data->>'telecaller', '') as telecaller,
         COALESCE(data->>'source', '') as source,
         COALESCE(data->>'creatorName', '') as "creatorName",
         COALESCE(data->>'dialedBy', '') as "dialedBy",
         COALESCE(data->>'callerName', '') as "callerName",
         COALESCE(data->>'followupDate', data->>'followup_date', '') as "followupDate",
         COALESCE(data->>'campaign', data->>'campaignName', '') as campaign
       FROM custom_records 
       ${leadWhere}`,
      leadParams
    );

    // 4. Query Assignments
    let assignRows: any[] = [];
    if (assignModule) {
      const assignModId = assignModule._id || assignModule.id;
      let assignWhere = `WHERE organization_id = $1 AND module_id = $2`;
      const assignParams: any[] = [orgId, assignModId];
      if (campaign && campaign !== 'ALL') {
        const camps = Array.isArray(campaign) ? campaign : [campaign];
        const validCamps = camps.map(c => String(c).toLowerCase().trim()).filter(c => c && c !== 'all');
        if (validCamps.length > 0) {
          assignParams.push(validCamps);
          assignWhere += ` AND lower(COALESCE(data->>'campaign', data->>'campaignName', '')) = ANY($3::text[])`;
        }
      }
      assignRows = await queryPg(
        `SELECT 
           id,
           COALESCE(data->>'assignedTo', '') as "assignedTo",
           COALESCE(data->>'telecaller', '') as telecaller,
           COALESCE(data->>'campaign', data->>'campaignName', '') as campaign
         FROM custom_records
         ${assignWhere}`,
        assignParams
      );
    }

    // 5. Build Aggregation Map for each User
    // Statuses that count as "Call Connected / Contacted / Dialed"
    const connectedStatuses = new Set([
      'HOT LEADS', 'WARM LEADS', 'APPROVED', 'DISBUSED', 'FOLLOWUP',
      'DOCUMENT PENDING', 'STATUS PENDING', 'CALL BACK', 'GIVEN LOGIN',
      'EXECUTIVE & BRANCH MEET', 'CONNECTED', 'CONTACTED', 'COOL LEAD'
    ]);

    const isConnectedLead = (status: string, dialStatus: string): boolean => {
      const s = (status || '').toUpperCase().trim();
      const ds = (dialStatus || '').toUpperCase().trim();
      if (connectedStatuses.has(s)) return true;
      if (ds && ds !== 'YET TO CALL' && ds !== 'NEW' && ds !== 'NOT DIALED') return true;
      return false;
    };

    // Prepare User List
    const agentStatsList = users.map((u: any) => {
      const uId = String(u._id || u.id);
      const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.name || u.email?.split('@')[0] || 'Agent';
      const uEmail = (u.email || '').toLowerCase().trim();
      const roleName = (u.roleId ? roleMap.get(String(u.roleId)) : '') || u.role?.name || u.role || 'Telecaller';

      // Match lead to user
      const userLeads = leadRows.filter((r: any) => {
        const assId = String(r.assignedTo || '').trim();
        const assName = String(r.assignedToName || '').toLowerCase().trim();
        const telName = String(r.telecaller || '').toLowerCase().trim();
        const srcName = String(r.source || '').toLowerCase().trim();
        const crName = String(r.creatorName || '').toLowerCase().trim();
        const dBy = String(r.dialedBy || '').toLowerCase().trim();
        const cName = String(r.callerName || '').toLowerCase().trim();
        const createdById = String(r.createdBy || '').trim();

        const nameLower = fullName.toLowerCase();

        return (
          assId === uId ||
          createdById === uId ||
          (uEmail && assId.toLowerCase() === uEmail) ||
          assName === nameLower ||
          telName === nameLower ||
          srcName === nameLower ||
          crName === nameLower ||
          dBy === nameLower ||
          cName === nameLower
        );
      });

      // Match assignments to user
      const userAssignments = assignRows.filter((r: any) => {
        const assId = String(r.assignedTo || '').trim();
        const telName = String(r.telecaller || '').toLowerCase().trim();
        const nameLower = fullName.toLowerCase();
        return assId === uId || (uEmail && assId.toLowerCase() === uEmail) || telName === nameLower;
      });

      const assignedLeadsCount = Math.max(userLeads.length, userAssignments.length);
      
      const callsConnectedCount = userLeads.filter((r: any) => isConnectedLead(r.status, r.dialStatus)).length;

      const followupsScheduledCount = userLeads.filter((r: any) => {
        const f = String(r.followupDate || '').trim();
        return f && f !== 'null' && f !== 'undefined' && f !== '-' && f !== '—' && f !== 'N/A';
      }).length;

      const connectionRate = assignedLeadsCount > 0 
        ? Math.round((callsConnectedCount / assignedLeadsCount) * 100) 
        : (callsConnectedCount > 0 ? 100 : 0);

      return {
        id: uId,
        _id: uId,
        name: fullName,
        email: u.email || `${fullName.toLowerCase().replace(/\s+/g, '')}@inkcrm.com`,
        role: roleName,
        assigned: assignedLeadsCount,
        connected: callsConnectedCount,
        followups: followupsScheduledCount,
        connectionRate
      };
    });

    // Filter by Role or Agent if requested
    let filteredAgents = agentStatsList;
    if (role && role !== 'ALL') {
      const rolesArr = Array.isArray(role) ? role : [role];
      const validRoles = rolesArr.map((r: any) => String(r).toLowerCase().trim()).filter((r: any) => r && r !== 'all');
      if (validRoles.length > 0) {
        filteredAgents = filteredAgents.filter((ag: any) => validRoles.includes(ag.role.toLowerCase()));
      }
    }

    if (agent && agent !== 'ALL') {
      const agentsArr = Array.isArray(agent) ? agent : [agent];
      const validAgents = agentsArr.map((a: any) => String(a).toLowerCase().trim()).filter((a: any) => a && a !== 'all');
      if (validAgents.length > 0) {
        filteredAgents = filteredAgents.filter((ag: any) => validAgents.includes(ag.name.toLowerCase()));
      }
    }

    // Sort by connected desc, then assigned desc
    filteredAgents.sort((a: any, b: any) => b.connected - a.connected || b.assigned - a.assigned);

    // Compute Summary KPIs
    const totalActiveTelecallers = filteredAgents.length;
    const totalAssignedLeads = filteredAgents.reduce((sum: number, a: any) => sum + a.assigned, 0);
    const totalCallsConnected = filteredAgents.reduce((sum: number, a: any) => sum + a.connected, 0);
    const totalFollowups = filteredAgents.reduce((sum: number, a: any) => sum + a.followups, 0);
    const avgConnectionRate = totalAssignedLeads > 0 
      ? Math.round((totalCallsConnected / totalAssignedLeads) * 100) 
      : 0;

    res.status(200).json({
      summary: {
        totalActiveTelecallers,
        totalCallsConnected,
        totalAssignedLeads,
        totalFollowups,
        connectionRate: avgConnectionRate
      },
      agents: filteredAgents,
      campaignsList: registeredCampaigns,
      rolesList: Array.from(new Set(roles.map((r: any) => r.name).filter(Boolean)))
    });
  } catch (error: any) {
    console.error('Telecaller performance aggregation error:', error);
    res.status(500).json({ error: error.message || 'Failed to aggregate telecaller performance' });
  }
});

// 1. Get all report definitions
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const reports = await ReportDefinition.find({ organizationId: req.organizationId });
    const moduleIds = [...new Set(reports.map((r: any) => r.moduleId).filter(Boolean))];
    let moduleMap = new Map();
    if (moduleIds.length > 0) {
      const modules = await ModuleDefinition.find({ _id: { $in: moduleIds } });
      moduleMap = new Map(modules.map((m: any) => [m._id || m.id, m]));
    }
    const populated = reports.map((r: any) => {
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve reports.' });
  }
});

// 2. Create/Save a report definition
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, moduleId, chartType, groupByField, metricField, aggregation, filters, columns } = req.body;

    if (!name || !moduleId || !chartType) {
      res.status(400).json({ error: 'Name, moduleId, and chartType are required.' });
      return;
    }

    const report = await ReportDefinition.create({
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to save report definition.' });
  }
});

// 3. Execute/Run a report (aggregating metrics & generating details)
router.get('/:id/run', async (req: Request, res: Response): Promise<void> => {
  try {
    const report = await ReportDefinition.findOne({
      _id: req.params.id,
      organizationId: req.organizationId
    });

    if (!report) {
      res.status(404).json({ error: 'Report definition not found.' });
      return;
    }

    if (report.moduleId) {
      const mod = await ModuleDefinition.findById(report.moduleId);
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
    const chartData = await ReportBuilderService.generateReport(report, req.user as any);
    // Generate detailed table rows
    const details = await ReportBuilderService.getReportDetails(report, req.user as any);

    res.status(200).json({
      report,
      chartData,
      details
    });
  } catch (error) {
    console.error('Run Report Error:', error);
    res.status(500).json({ error: 'Failed to execute report aggregations.' });
  }
});

// 4. Delete report definition
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const report = await ReportDefinition.findOneAndDelete({
      _id: req.params.id,
      organizationId: req.organizationId
    });

    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    res.status(200).json({ message: 'Report definition deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete report.' });
  }
});

export default router;
