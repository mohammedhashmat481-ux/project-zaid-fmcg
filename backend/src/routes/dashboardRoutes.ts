import { Router, Request, Response } from 'express';
import DashboardLayout from '../models/DashboardLayout';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import Activity from '../models/Activity';
import User from '../models/User';
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
      // Differentiate Campaign Contacts vs Real Leads:
      // Real pipeline leads strictly match the 11 pipeline stages. Raw campaign contacts (telecalling list) are excluded.
      leadQuery['data.status'] = {
        $regex: '^(HOT(\\s+LEADS?)?|WARM(\\s+LEADS?)?|CE[BD]IL(\\s+PENDING)?|DOC(UMENT)?S?(\\s+PENDING)?|PROPOSAL|APPROVALS?(\\s+PENDING)?|NEGOTIATION|APPROVED(\\s+BUT\\s+NOT\\s+DISBU(RS|S)E?D?)?|DISBU(RS|S)E?D?|REJECT(ED)?|FOLLOW[- ]?UP|DROP(PED)?|PENDING|INK\\s*WORLDWIDE)$'
      };
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

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    if (leadModule) {
      // 1. Group leads count by status dynamically using tenant/hierarchy leadQuery
      const followUpQuery: any = {
        ...leadQuery
      };
      const timeFilter = {
        $or: [
          { 'data.followUpDate': localTodayStr },
          { 'data.followUpDate': utcTodayStr },
          { 'data.followUpDate': { $regex: `^(${localTodayStr}|${utcTodayStr})` } },
          { 'data.followUpDate': { $gte: startOfToday, $lte: endOfToday } }
        ]
      };
      if (followUpQuery.$or) {
        const existingOr = followUpQuery.$or;
        delete followUpQuery.$or;
        followUpQuery.$and = [
          { $or: existingOr },
          timeFilter
        ];
      } else if (followUpQuery.$and) {
        followUpQuery.$and.push(timeFilter);
      } else {
        Object.assign(followUpQuery, timeFilter);
      }

      const upcomingQuery: any = {
        ...leadQuery
      };
      const futureFilter = {
        $or: [
          { 'data.followUpDate': { $gt: localTodayStr } },
          { 'data.followUpDate': { $gt: utcTodayStr } },
          { 'data.followUpDate': { $gt: endOfToday } }
        ]
      };
      if (upcomingQuery.$or) {
        const existingOr = upcomingQuery.$or;
        delete upcomingQuery.$or;
        upcomingQuery.$and = [
          { $or: existingOr },
          futureFilter
        ];
      } else if (upcomingQuery.$and) {
        upcomingQuery.$and.push(futureFilter);
      } else {
        Object.assign(upcomingQuery, futureFilter);
      }

      const activityQuery: Record<string, any> = { organizationId: orgId };
      const isSuper = await HierarchyService.isSuperAdmin(req.user?.roleId);
      if (!isSuper) {
        const descendants = await HierarchyService.getSubordinateUserIds(req.user?.id as string, orgId!);
        const allowedUserIds = [String(req.user?.id), ...descendants];
        activityQuery.userId = { $in: allowedUserIds };
      }

      // Execute all independent queries in parallel for lightning-fast response (<70ms)
      const [
        leadAgg,
        todayFollowupsCountRes,
        todayFollowupsListRes,
        upcomingFollowupsListRes,
        totalLeadsRes,
        dealAggRes,
        recentActivitiesRes
      ] = await Promise.all([
        CustomRecord.aggregate([
          { $match: leadQuery },
          { $group: { _id: '$data.status', count: { $sum: 1 } } }
        ]),
        CustomRecord.countDocuments(followUpQuery),
        CustomRecord.find(followUpQuery)
          .populate('createdBy', 'firstName lastName name email')
          .sort({ 'data.followUpDate': 1 })
          .limit(10),
        CustomRecord.find(upcomingQuery)
          .populate('createdBy', 'firstName lastName name email')
          .sort({ 'data.followUpDate': 1 })
          .limit(10),
        CustomRecord.countDocuments(leadQuery),
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

      leadAgg.forEach((item: any) => {
        if (item._id) {
          const rawName = item._id.toString().trim();
          const upper = rawName.toUpperCase();
          const count = Number(item.count || 0);
          statusCounts[upper] = (statusCounts[upper] || 0) + count;
          if (rawName !== upper) {
            statusCounts[rawName] = count;
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
        totalLeads: totalLeadsRes,
        recentActivities: recentActivitiesRes
      };

      serverCache.set(cacheKey, resultData, 45); // 45 seconds cache TTL
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
