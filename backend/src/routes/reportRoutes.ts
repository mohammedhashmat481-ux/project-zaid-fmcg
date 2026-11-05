import { Router, Request, Response } from 'express';
import ReportDefinition from '../models/ReportDefinition';
import ModuleDefinition from '../models/ModuleDefinition';
import { ReportBuilderService } from '../services/reportBuilder';
import { authenticate } from '../middleware/authMiddleware';
import { requireTenant } from '../middleware/tenantMiddleware';

import CustomRecord from '../models/CustomRecord';
import User from '../models/User';
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
      period = 'daily',
      metric = 'callsMade',
      userId = 'ALL',
      roleId = 'ALL'
    } = req.query;

    const selectedDateStr = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
      ? date
      : istNowStr;

    const [dYear, dMonth, dDay] = selectedDateStr.split('-').map(Number);
    const dailyTargetDay = dDay; // 1 to 31
    const dailyTargetMonthIndex = dMonth - 1; // 0 to 11
    const dailyTargetYear = dYear;

    const cacheKey = CacheKeys.campaignMatrix(
      orgId!,
      `${period}:${metric}:${campaignName}:${month}:${year}:${selectedDateStr}:${userId}:${roleId}`
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

    // Fetch Campaign Assignments
    let assignmentDocs: any[] = [];
    if (assignmentModule) {
      assignmentDocs = await CustomRecord.find({ organizationId: orgId, moduleId: assignmentModule._id || assignmentModule.id })
        .select('_id data.campaign data.campaignName data.assignedTo data.telecaller createdAt')
        .lean();
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
        // Person who actually initiated or logged the call
        candidateList = [
          d.dialedBy,
          d.callerName,
          d.lastDialedBy,
          item.updatedBy,
          d.assignedTo?.name,
          d.assignedTo?.email,
          d.assignedTo?._id,
          d.assignedTo,
          d.telecaller,
          item.assignedTo?.name,
          item.assignedTo,
          item.createdBy,
          d.source,
          d.creatorName
        ];
      } else if (metricType === 'hotLeads' || metricType === 'warmLeads') {
        // Person who created or sourced the hot/warm lead
        candidateList = [
          d.source,
          d.creatorName,
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
          d.creatorName
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

    // Helper: Determine if a lead has ACTUALLY been dialed / called
    // (A newly created lead in form without a call made is NOT dialed!)
    const isLeadDialed = (lead: any): boolean => {
      const d = lead.data || {};
      if (d.dialedAt) return true;
      const callAttempts = Number(d.callAttempts || 0);
      if (callAttempts > 0) return true;
      const dialSt = (d.dialStatus || '').toString().toLowerCase().trim();
      if (dialSt && !['new', 'yet to call', 'unassigned', ''].includes(dialSt)) return true;
      return false;
    };

    // Helper: Resolve the real date of an event (in Indian Standard Time UTC+05:30)
    // NEVER uses followUpDate for calls made (followUpDate is a scheduled future date!)
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const getEventDateParts = (lead: any, metricType: string) => {
      const d = lead.data || {};
      let rawDate: any = null;

      if (metricType === 'callsMade' || metricType === 'leadsCalled') {
        rawDate = d.dialedAt || (isLeadDialed(lead) ? (lead.updatedAt || lead.createdAt) : null);
      } else if (metricType === 'hotLeads') {
        rawDate = d.hotDate || lead.updatedAt || lead.createdAt;
      } else if (metricType === 'logins') {
        rawDate = d.loginDate || lead.updatedAt || lead.createdAt;
      } else if (metricType === 'approved') {
        rawDate = d.approvalDate || lead.updatedAt || lead.createdAt;
      } else if (metricType === 'disbursed') {
        rawDate = d.disbursalDate || lead.updatedAt || lead.createdAt;
      } else {
        rawDate = d.dialedAt || (isLeadDialed(lead) ? (lead.updatedAt || lead.createdAt) : null);
      }

      if (!rawDate) return null;
      const dateObj = new Date(rawDate);
      const timeMs = dateObj.getTime();
      if (isNaN(timeMs)) return null;

      // Cap at current time to never project events into future days beyond today (IST)
      const currentMs = Date.now();
      const validTimeMs = timeMs > currentMs ? currentMs : timeMs;
      const istDate = new Date(validTimeMs + IST_OFFSET_MS);

      return {
        year: istDate.getUTCFullYear(),
        month: istDate.getUTCMonth(), // 0 to 11
        day: istDate.getUTCDate(), // 1 to 31
        hour: istDate.getUTCHours() // 0 to 23
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

    let columns: string[] = [];
    if (period === 'daily') {
      columns = HOURLY_COLUMNS;
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
      const leadsByDay: Record<number, any[]> = {};
      const leadsByMonth: Record<number, any[]> = {};

      HOURLY_COLUMNS.forEach(col => { leadsByHour[col] = []; });

      relevantLeads.forEach(l => {
        const parts = getEventDateParts(l, String(metric));
        if (parts) {
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
        return parts.year === dailyTargetYear && parts.month === dailyTargetMonthIndex && parts.day === dailyTargetDay;
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
      selectedDate: selectedDateStr,
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
