import { Router, Request, Response } from 'express';
import DashboardLayout from '../models/DashboardLayout';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import Activity from '../models/Activity';
import User from '../models/User';
import { getRealLeadStatuses, RAW_CAMPAIGN_DISPOSITIONS } from '../utils/leadStatusHelper';
import Status from '../models/Status';
import { authenticate } from '../middleware/authMiddleware';
import { requireTenant } from '../middleware/tenantMiddleware';
import { HierarchyService } from '../utils/hierarchy';
import { serverCache, CacheKeys, CacheInvalidators } from '../utils/cache';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

// 1. Get Dashboard Layout for User
router.get('/layout', async (req: Request, res: Response): Promise<void> => {
  try {
    // Attempt to locate a user-specific dashboard layout
    let layout = await DashboardLayout.findOne({
      organizationId: req.organizationId,
      userId: req.user?.id
    });

    // Fallback: locate the organization's default dashboard layout
    if (!layout) {
      layout = await DashboardLayout.findOne({
        organizationId: req.organizationId,
        isDefault: true
      });
    }

    res.status(200).json(layout || { widgets: [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve dashboard configuration.' });
  }
});

// 2. Save/Update Dashboard Layout
router.put('/layout', async (req: Request, res: Response): Promise<void> => {
  try {
    const { widgets } = req.body;

    let layout = await DashboardLayout.findOne({
      organizationId: req.organizationId,
      userId: req.user?.id
    });

    if (layout) {
      layout.widgets = widgets;
      await layout.save();
    } else {
      layout = await DashboardLayout.create({
        organizationId: req.organizationId,
        userId: req.user?.id,
        name: 'My Dashboard',
        widgets
      });
    }

    CacheInvalidators.invalidateDashboard(req.organizationId!);
    res.status(200).json(layout);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update dashboard widgets.' });
  }
});

// 3. Fetch Real-time Metadata KPI Counts
router.get('/metrics', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const userScopeKey = req.user?.id ? `${req.user.id}:${req.user.roleId || 'role'}` : 'anon';
    const cacheKey = CacheKeys.dashboardMetrics(orgId!, userScopeKey);
    const cachedData = serverCache.get(cacheKey);

    if (cachedData) {
      res.setHeader('X-Cache', 'HIT');
      res.status(200).json(cachedData);
      return;
    }
    
    // Find Lead and Deal Module Definitions
    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    const dealModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'deals' });

    const leadQuery: Record<string, any> = {
      organizationId: orgId
    };
    if (leadModule) {
      leadQuery.moduleId = leadModule._id;
    }
    const dealQuery: Record<string, any> = {
      organizationId: orgId
    };
    if (dealModule) {
      dealQuery.moduleId = dealModule._id;
    }

    // Apply Dynamic Reporting Manager Hierarchy filtering
    await HierarchyService.modifyRecordQuery(leadQuery, req.user as any, orgId!);
    await HierarchyService.modifyRecordQuery(dealQuery, req.user as any, orgId!);

    const statusCounts: Record<string, number> = {};
    const pipelineData: Record<string, number> = {
      'Prospecting': 0,
      'Qualification': 0,
      'Proposal': 0,
      'Negotiation': 0,
      'Closed Won': 0,
      'Closed Lost': 0
    };

    let dealStatus = { open: 0, won: 0, lost: 0, pending: 0 };
    let todayFollowupsCount = 0;
    let todayFollowupsList: any[] = [];

    const now = new Date();
    const localTodayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const utcTodayStr = now.toISOString().split('T')[0];

    if (leadModule) {
      // Direct indexed follow-up date lookups
      const followUpQuery: any = {
        organizationId: orgId,
        moduleId: leadModule._id,
        'data.followUpDate': { $in: [localTodayStr, utcTodayStr] }
      };
      await HierarchyService.modifyRecordQuery(followUpQuery, req.user as any, orgId!);

      const upcomingQuery: any = {
        organizationId: orgId,
        moduleId: leadModule._id,
        'data.followUpDate': { $gt: localTodayStr > utcTodayStr ? localTodayStr : utcTodayStr }
      };
      await HierarchyService.modifyRecordQuery(upcomingQuery, req.user as any, orgId!);

      const activityQuery: Record<string, any> = { organizationId: orgId };
      const isSuper = await HierarchyService.isSuperAdmin(req.user?.roleId);
      if (!isSuper) {
        const descendants = await HierarchyService.getSubordinateUserIds(req.user?.id as string, orgId!);
        const allowedUserIds = [String(req.user?.id), ...descendants];
        activityQuery.userId = { $in: allowedUserIds };
      }

      // Execute all independent queries in parallel using indexed columns (<30ms)
      const [
        leadAgg,
        todayFollowupsCountRes,
        todayFollowupsListRes,
        upcomingFollowupsListRes,
        dealAggRes,
        recentActivitiesRes
      ] = await Promise.all([
        CustomRecord.aggregate([
          { $match: leadQuery },
          { $group: { _id: '$data.status', count: { $sum: 1 } } }
        ]),
        CustomRecord.countDocuments(followUpQuery),
        CustomRecord.find(followUpQuery)
          .select('_id data.firstName data.lastName data.company data.phone data.budget data.followUpDate data.status data.caseDetails createdBy')
          .populate('createdBy', 'firstName lastName name email')
          .sort({ 'data.followUpDate': 1 })
          .limit(10),
        CustomRecord.find(upcomingQuery)
          .select('_id data.firstName data.lastName data.company data.phone data.budget data.followUpDate data.status data.caseDetails createdBy')
          .populate('createdBy', 'firstName lastName name email')
          .sort({ 'data.followUpDate': 1 })
          .limit(10),
        dealModule
          ? CustomRecord.aggregate([
              { $match: dealQuery },
              { $group: { _id: '$data.stage', total: { $sum: { $toDouble: '$data.amount' } } } }
            ])
          : Promise.resolve([]),
        Activity.find(activityQuery)
          .populate('userId', 'firstName lastName')
          .sort({ createdAt: -1 })
          .limit(10)
      ]);

      // Retrieve real lead statuses (configured statuses from DB + standard pipeline statuses, excluding raw call dispositions)
      const realLeadStatuses = await getRealLeadStatuses(orgId);

      // Group into canonical status buckets without double-counting
      const canonicalMap: Record<string, number> = {};
      let totalPipelineLeads = 0;

      leadAgg.forEach((item: any) => {
        if (item._id) {
          const rawName = item._id.toString().trim();
          const upper = rawName.toUpperCase();
          const count = Number(item.count || 0);

          // Canonicalize status to match standard dashboard cards
          let canonical = upper;
          if (upper === 'HOT' || upper === 'HOT LEAD' || upper === 'HOT LEADS') {
            canonical = 'HOT LEADS';
          } else if (upper === 'WARM' || upper === 'WARM LEAD' || upper === 'WARM LEADS' || upper === 'DEMO') {
            canonical = 'WARM LEADS';
          } else if (upper === 'COOL' || upper === 'COOL LEAD' || upper === 'COOL LEADS') {
            canonical = 'COOL LEAD';
          } else if (upper === 'CEDIL PENDING' || upper === 'CEBIL PENDING' || upper === 'CEDIL' || upper === 'CEBIL') {
            canonical = 'CEBIL PENDING';
          } else if (upper === 'DOCUMENT PENDING' || upper === 'DOCUMENTS PENDING' || upper === 'DOCS PENDING') {
            canonical = 'DOCUMENT PENDING';
          } else if (upper === 'STATUS PENDING' || upper === 'APPROVAL PENDING' || upper === 'APPROVALS PENDING') {
            canonical = 'STATUS PENDING';
          } else if (upper === 'APPROVED' || upper === 'APPROVED BUT NOT DISBUSE' || upper === 'APPROVED BUT NOT DISBURSED' || upper === 'APPROVED BUT NOT DISBURSE') {
            canonical = 'APPROVED';
          } else if (upper === 'DISBUSED' || upper === 'DISBURSED' || upper === 'DISBURSED PENDING') {
            canonical = 'DISBUSED';
          } else if (upper === 'REJECTED' || upper === 'REJECT' || upper === 'REJECT PENDING') {
            canonical = 'REJECTED';
          } else if (upper === 'FOLLOWUP' || upper === 'FOLLOW-UP' || upper === 'FOLLOW UP') {
            canonical = 'FOLLOWUP';
          } else if (upper === 'DROPPED' || upper === 'DROP' || upper === 'DEAD LEADS' || upper === 'CLOSED') {
            canonical = 'DROPPED';
          } else if (upper === 'PENDING') {
            canonical = 'PENDING';
          } else if (upper === 'GIVEN LOGIN' || upper === 'LOGIN' || upper === 'LOGIN PENDING') {
            canonical = 'GIVEN LOGIN';
          }

          // Strictly exclude raw campaign dialing dispositions (e.g. NEW, NOT CONNECTED, NO ANSWER) from pipeline counts
          const strippedUpper = upper.replace(/\s+LEADS?$/i, '').trim();
          const isDisposition = RAW_CAMPAIGN_DISPOSITIONS.has(upper) || RAW_CAMPAIGN_DISPOSITIONS.has(strippedUpper) || upper === 'NEW' || upper === 'NEWS';
          if (isDisposition) {
            return;
          }

          const isReal = realLeadStatuses.has(upper) || realLeadStatuses.has(rawName) || realLeadStatuses.has(strippedUpper) || realLeadStatuses.has(canonical);
          if (!isReal) {
            return;
          }

          totalPipelineLeads += count;
          canonicalMap[canonical] = (canonicalMap[canonical] || 0) + count;
        }
      });

      // Populate statusCounts from canonical buckets: each bucket distributes to its synonyms
      Object.entries(canonicalMap).forEach(([canonical, count]) => {
        statusCounts[canonical] = count;

        const stripped = canonical.replace(/\s+LEADS?$/i, '').trim();
        if (stripped) {
          if (statusCounts[stripped] === undefined) statusCounts[stripped] = count;
          if (statusCounts[`${stripped} LEAD`] === undefined) statusCounts[`${stripped} LEAD`] = count;
          if (statusCounts[`${stripped} LEADS`] === undefined) statusCounts[`${stripped} LEADS`] = count;
        }

        const noS = canonical.endsWith('S') ? canonical.slice(0, -1) : canonical;
        const withS = canonical.endsWith('S') ? canonical : `${canonical}S`;
        if (statusCounts[noS] === undefined) statusCounts[noS] = count;
        if (statusCounts[withS] === undefined) statusCounts[withS] = count;
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
        dealAggRes.forEach((item: any) => {
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

      serverCache.set(cacheKey, resultData, 60); // 60s cache TTL (automatically invalidated on any record mutation/dial/status update)
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
    serverCache.set(cacheKey, fallbackData, 45);
    res.setHeader('X-Cache', 'MISS');
    res.status(200).json(fallbackData);
  } catch (error) {
    console.error('Metrics Error:', error);
    res.status(500).json({ error: 'Failed to retrieve dashboard KPI metrics.' });
  }
});

export default router;
