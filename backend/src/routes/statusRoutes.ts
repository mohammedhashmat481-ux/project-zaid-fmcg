import { Router, Request, Response } from 'express';
import Status from '../models/Status';
import Organization from '../models/Organization';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import { queryPg } from '../config/postgres';
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
  // No-op: campaign status configuration in Organization.themeSettings is managed independently
  // by Campaign Status Settings and should never be overwritten by general status operations.
}

// 1. Get all statuses
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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
        { name: 'STATUS PENDING', color: '#F97316', icon: 'Clock', pipelinePosition: 6, order: 6 },
        { name: 'APPROVED', color: '#10B981', icon: 'CheckCircle', pipelinePosition: 7, order: 7 },
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

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Status name is required.' });
      return;
    }

    const trimmedName = name.trim();

    // Check if status with same name already exists in this org
    const existing = await Status.findOne({
      organizationId: req.organizationId,
      name: trimmedName
    });
    if (existing) {
      res.status(400).json({ error: `A status named "${trimmedName}" already exists.` });
      return;
    }

    const count = await Status.countDocuments({ organizationId: req.organizationId });
    let calculatedOrder = Number(order) || (count + 1);
    if (calculatedOrder < 1) calculatedOrder = count + 1;

    let calculatedPos = Number(pipelinePosition) || calculatedOrder;
    if (calculatedPos < 1) calculatedPos = calculatedOrder;

    const newStatusFields: any = {
      organizationId: req.organizationId,
      name: trimmedName,
      color: color || '#4F46E5',
      icon: icon || 'Circle',
      pipelinePosition: calculatedPos,
      dashboardVisibility: dashboardVisibility !== undefined ? Boolean(dashboardVisibility) : true,
      isFinal: isFinal !== undefined ? Boolean(isFinal) : false,
      isSuccess: isSuccess !== undefined ? Boolean(isSuccess) : false,
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
    if (error.code === '23505' || error.code === 11000) {
      res.status(400).json({ error: 'Status name must be unique.' });
    } else {
      res.status(500).json({ error: error.message || 'Failed to create status.' });
    }
  }
});

// 3. Update status
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const statusId = req.params.id;
    const { name, color, icon, pipelinePosition, dashboardVisibility, isFinal, isSuccess, order } = req.body;

    let status = await Status.findOne({ _id: statusId, organizationId: req.organizationId });
    if (!status) {
      status = await Status.findById(statusId);
    }
    if (!status) {
      res.status(404).json({ error: 'Status not found.' });
      return;
    }

    const oldName = status.name;
    if (name && name.trim()) status.name = name.trim();
    if (color) status.color = color;
    if (icon) status.icon = icon;
    if (pipelinePosition !== undefined) status.pipelinePosition = Number(pipelinePosition);
    if (dashboardVisibility !== undefined) status.dashboardVisibility = Boolean(dashboardVisibility);
    if (isFinal !== undefined) status.isFinal = Boolean(isFinal);
    if (isSuccess !== undefined) status.isSuccess = Boolean(isSuccess);

    if (order !== undefined && Number(order) > 0) {
      const targetOrder = Math.max(1, Number(order));
      const tempWrapper = { order: targetOrder };
      await adjustStatusOrders(req.organizationId, (status._id || status.id).toString(), targetOrder, tempWrapper);
      status.order = tempWrapper.order;
    }

    await status.save();

    // If status name changed, cascade to existing leads in custom_records
    if (name && oldName && oldName.trim().toUpperCase() !== name.trim().toUpperCase()) {
      try {
        await queryPg(
          `UPDATE custom_records 
           SET data = jsonb_set(data, '{status}', to_jsonb($1::text)),
               updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $2 AND UPPER(data->>'status') = UPPER($3)`,
          [name.trim(), req.organizationId, oldName.trim()]
        );
      } catch (updErr) {
        console.warn('Could not cascade status rename to custom_records:', updErr);
      }
    }
    await syncOrganizationDashboardStatuses(req.organizationId);
    CacheInvalidators.invalidateStatuses(req.organizationId!);
    CacheInvalidators.invalidateDashboard(req.organizationId!);
    res.status(200).json(status);
  } catch (error: any) {
    if (error.code === '23505' || error.code === 11000) {
      res.status(400).json({ error: 'Status name must be unique.' });
    } else {
      res.status(500).json({ error: error.message || 'Failed to update status.' });
    }
  }
});

// 4. Delete status
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const statusId = req.params.id;
    let status = await Status.findOne({ _id: statusId, organizationId: req.organizationId });
    if (!status) {
      status = await Status.findById(statusId);
    }
    if (!status) {
      res.status(404).json({ error: 'Status not found.' });
      return;
    }

    const orgId = status.organizationId || req.organizationId;
    await Status.deleteOne({ _id: status._id || status.id });
    await reorderAfterDelete(orgId);
    await syncOrganizationDashboardStatuses(orgId);
    CacheInvalidators.invalidateStatuses(orgId);
    CacheInvalidators.invalidateDashboard(orgId);
    res.status(200).json({ message: 'Status deleted successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete status.' });
  }
});

export default router;
