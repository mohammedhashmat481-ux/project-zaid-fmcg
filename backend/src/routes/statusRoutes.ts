import { Router, Request, Response } from 'express';
import Status from '../models/Status';
import Organization from '../models/Organization';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import { authenticate } from '../middleware/authMiddleware';
import { requireTenant } from '../middleware/tenantMiddleware';
import { serverCache, CacheKeys, CacheInvalidators } from '../utils/cache';
import { RAW_CAMPAIGN_DISPOSITIONS } from '../utils/leadStatusHelper';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

// Helper function to dynamically adjust status orders sequentially
async function adjustStatusOrders(organizationId: any, statusIdToPlace: string | null, targetOrder: number, newStatusFields: any) {
  let statuses = await Status.find({ organizationId }).sort({ order: 1 });
  if (statusIdToPlace) {
    statuses = statuses.filter((s: any) => s._id.toString() !== statusIdToPlace.toString());
  }
  const insertIdx = Math.max(0, Math.min(targetOrder - 1, statuses.length));
  const resultList: any[] = [];
  for (let i = 0; i < statuses.length; i++) {
    if (i === insertIdx) {
      resultList.push({ isTarget: true });
    }
    resultList.push(statuses[i]);
  }
  if (insertIdx >= statuses.length) {
    resultList.push({ isTarget: true });
  }
  for (let index = 0; index < resultList.length; index++) {
    const item = resultList[index];
    const finalOrder = index + 1;
    if (item.isTarget) {
      newStatusFields.order = finalOrder;
    } else {
      if (item.order !== finalOrder) {
        item.order = finalOrder;
        await item.save();
      }
    }
  }
}

// Helper function to close gaps when a status is deleted
async function reorderAfterDelete(organizationId: any) {
  const statuses = await Status.find({ organizationId }).sort({ order: 1 });
  for (let index = 0; index < statuses.length; index++) {
    const item = statuses[index];
    const finalOrder = index + 1;
    if (item.order !== finalOrder) {
      item.order = finalOrder;
      await item.save();
    }
  }
}

// Helper function to sync organization dashboardStatuses with PostgreSQL statuses
async function syncOrganizationDashboardStatuses(organizationId: any) {
  try {
    const org = await Organization.findById(organizationId);
    if (!org) return;
    const allStatuses = await Status.find({ organizationId });
    const dashNames = allStatuses
      .filter((s: any) => s.dashboardVisibility !== false)
      .map((s: any) => String(s.name || '').trim().toUpperCase())
      .filter(Boolean);
    const existingConfig = org.themeSettings?.campaignStatusConfig || {};
    org.themeSettings = {
      ...(org.themeSettings || {}),
      campaignStatusConfig: {
        ...existingConfig,
        dashboardStatuses: Array.from(new Set(dashNames))
      }
    };
    await org.save();
  } catch (e) {
    console.warn('Failed to sync organization dashboard statuses:', e);
  }
}

// 1. Get all statuses
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const cacheKey = CacheKeys.statuses(req.organizationId!);
    const cached = serverCache.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.status(200).json(cached);
      return;
    }

    let statuses = await Status.find({ organizationId: req.organizationId }).sort({ order: 1 });
    
    // Auto-seed default standard statuses if none exist yet for this organization
    if (statuses.length === 0) {
      const defaultStatuses = [
        { name: 'HOT LEADS', color: '#EF4444', icon: 'Flame', pipelinePosition: 1, order: 1 },
        { name: 'WARM LEADS', color: '#F59E0B', icon: 'Sun', pipelinePosition: 2, order: 2 },
        { name: 'COOL LEAD', color: '#06B6D4', icon: 'Snowflake', pipelinePosition: 3, order: 3 },
        { name: 'CEBIL PENDING', color: '#EC4899', icon: 'FileWarning', pipelinePosition: 4, order: 4 },
        { name: 'DOCUMENT PENDING', color: '#14B8A6', icon: 'FileText', pipelinePosition: 5, order: 5 },
        { name: 'APPROVAL PENDING', color: '#F97316', icon: 'Clock', pipelinePosition: 6, order: 6 },
        { name: 'APPROVED BUT NOT DISBUSE', color: '#10B981', icon: 'CheckCircle', pipelinePosition: 7, order: 7 },
        { name: 'DISBUSED', color: '#84CC16', icon: 'Banknote', pipelinePosition: 8, order: 8, isFinal: true, isSuccess: true },
        { name: 'REJECTED', color: '#F43F5E', icon: 'XOctagon', pipelinePosition: 9, order: 9, isFinal: true, isSuccess: false },
        { name: 'FOLLOWUP', color: '#0EA5E9', icon: 'PhoneCall', pipelinePosition: 10, order: 10 },
        { name: 'DROPPED', color: '#EF4444', icon: 'ArrowDownCircle', pipelinePosition: 11, order: 11, isFinal: true, isSuccess: false },
        { name: 'PENDING', color: '#EAB308', icon: 'Hourglass', pipelinePosition: 12, order: 12 },
        { name: 'GIVEN LOGIN', color: '#8B5CF6', icon: 'KeyRound', pipelinePosition: 13, order: 13 }
      ];
      
      const toInsert = defaultStatuses.map(s => ({
        organizationId: req.organizationId,
        ...s,
        dashboardVisibility: true,
        isFinal: (s as any).isFinal || false,
        isSuccess: (s as any).isSuccess || false
      }));

      try {
        await Status.insertMany(toInsert, { ordered: false });
      } catch (insertErr) {
        // ignore duplicate key errors if already concurrently inserted
      }
      statuses = await Status.find({ organizationId: req.organizationId }).sort({ order: 1 });
    }

    // Auto-ensure standard statuses (COOL LEAD, GIVEN LOGIN) exist for this organization
    const existingNames = new Set(statuses.map((s: any) => (s.name || '').toUpperCase().trim()));
    const missingStandard: any[] = [];
    let maxOrder = statuses.length > 0 ? Math.max(...statuses.map((s: any) => s.order || 0)) : 0;

    if (!existingNames.has('COOL LEAD') && !existingNames.has('COOL LEADS') && !existingNames.has('COOL')) {
      maxOrder++;
      missingStandard.push({
        organizationId: req.organizationId,
        name: 'COOL LEAD',
        color: '#06B6D4',
        icon: 'Snowflake',
        category: 'pipeline',
        pipelinePosition: maxOrder,
        order: maxOrder,
        dashboardVisibility: true,
        isFinal: false,
        isSuccess: false
      });
      existingNames.add('COOL LEAD');
      existingNames.add('COOL LEADS');
    }

    if (!existingNames.has('GIVEN LOGIN') && !existingNames.has('LOGIN')) {
      maxOrder++;
      missingStandard.push({
        organizationId: req.organizationId,
        name: 'GIVEN LOGIN',
        color: '#8B5CF6',
        icon: 'KeyRound',
        category: 'pipeline',
        pipelinePosition: maxOrder,
        order: maxOrder,
        dashboardVisibility: true,
        isFinal: false,
        isSuccess: false
      });
      existingNames.add('GIVEN LOGIN');
    }

    // Automatically purge any raw dialing dispositions that may have been saved to statuses
    const invalidStatuses = statuses.filter((s: any) => {
      const u = (s.name || '').toUpperCase().trim();
      const stripped = u.replace(/\s+LEADS?$/i, '').trim();
      return RAW_CAMPAIGN_DISPOSITIONS.has(u) || RAW_CAMPAIGN_DISPOSITIONS.has(stripped) || u === 'NEWS' || u === 'NEW';
    });
    if (invalidStatuses.length > 0) {
      const invalidIds = invalidStatuses.map((s: any) => s._id);
      await Status.deleteMany({ _id: { $in: invalidIds } });
      statuses = statuses.filter((s: any) => !invalidIds.includes(s._id));
    }

    // Deduplicate any duplicate status entries (e.g. "Warm Lead" and "WARM LEADS")
    const seenCanonical = new Set<string>();
    const duplicateIds: any[] = [];
    for (const s of statuses) {
      const u = (s.name || '').toUpperCase().trim();
      const stripped = u.replace(/\s+LEADS?$/i, '').trim();
      const canonicalKey = stripped || u;
      if (seenCanonical.has(canonicalKey)) {
        duplicateIds.push(s._id);
      } else {
        seenCanonical.add(canonicalKey);
      }
    }
    if (duplicateIds.length > 0) {
      await Status.deleteMany({ _id: { $in: duplicateIds } });
      statuses = statuses.filter((s: any) => !duplicateIds.includes(s._id));
    }

    if (missingStandard.length > 0) {
      try {
        await Status.insertMany(missingStandard, { ordered: false });
        statuses = await Status.find({ organizationId: req.organizationId }).sort({ order: 1 });
      } catch (_) {}
    }

    serverCache.set(cacheKey, statuses, 600); // 10 minutes cache
    res.setHeader('X-Cache', 'MISS');
    res.status(200).json(statuses);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve statuses.' });
  }
});

// 2. Create new status
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, color, icon, pipelinePosition, dashboardVisibility, isFinal, isSuccess, order } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required.' });
      return;
    }

    // Auto-calculate order if not provided
    let calculatedOrder = order;
    if (order === undefined || order === 0) {
      const count = await Status.countDocuments({ organizationId: req.organizationId });
      calculatedOrder = count + 1;
    }
    calculatedOrder = Math.max(1, calculatedOrder);

    const newStatusFields: any = {
      organizationId: req.organizationId,
      name,
      color: color || '#4F46E5',
      icon: icon || 'Circle',
      pipelinePosition: pipelinePosition || 0,
      dashboardVisibility: dashboardVisibility !== undefined ? dashboardVisibility : true,
      isFinal: isFinal !== undefined ? isFinal : false,
      isSuccess: isSuccess !== undefined ? isSuccess : false,
      order: calculatedOrder
    };

    // Shift other statuses to accommodate the new status
    await adjustStatusOrders(req.organizationId, null, calculatedOrder, newStatusFields);

    const status = await Status.create(newStatusFields);
    await syncOrganizationDashboardStatuses(req.organizationId);
    CacheInvalidators.invalidateStatuses(req.organizationId!);
    CacheInvalidators.invalidateDashboard(req.organizationId!);
    res.status(201).json(status);
  } catch (error: any) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'Status name must be unique.' });
    } else {
      res.status(500).json({ error: 'Failed to create status.' });
    }
  }
});

// 3. Update status
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, color, icon, pipelinePosition, dashboardVisibility, isFinal, isSuccess, order } = req.body;

    const status = await Status.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!status) {
      res.status(404).json({ error: 'Status not found.' });
      return;
    }

    if (name) status.name = name;
    if (color) status.color = color;
    if (icon) status.icon = icon;
    if (pipelinePosition !== undefined) status.pipelinePosition = pipelinePosition;
    if (dashboardVisibility !== undefined) status.dashboardVisibility = dashboardVisibility;
    if (isFinal !== undefined) status.isFinal = isFinal;
    if (isSuccess !== undefined) status.isSuccess = isSuccess;

    if (order !== undefined) {
      const targetOrder = Math.max(1, order);
      const tempWrapper = { order: targetOrder };
      await adjustStatusOrders(req.organizationId, status._id.toString(), targetOrder, tempWrapper);
      status.order = tempWrapper.order;
    }

    await status.save();
    await syncOrganizationDashboardStatuses(req.organizationId);
    CacheInvalidators.invalidateStatuses(req.organizationId!);
    CacheInvalidators.invalidateDashboard(req.organizationId!);
    res.status(200).json(status);
  } catch (error: any) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'Status name must be unique.' });
    } else {
      res.status(500).json({ error: 'Failed to update status.' });
    }
  }
});

// 4. Delete status
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const status = await Status.findOneAndDelete({ _id: req.params.id, organizationId: req.organizationId });
    if (!status) {
      res.status(404).json({ error: 'Status not found.' });
      return;
    }
    await reorderAfterDelete(req.organizationId);
    await syncOrganizationDashboardStatuses(req.organizationId);
    CacheInvalidators.invalidateStatuses(req.organizationId!);
    CacheInvalidators.invalidateDashboard(req.organizationId!);
    res.status(200).json({ message: 'Status deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete status.' });
  }
});

export default router;
