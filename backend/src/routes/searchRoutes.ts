import { Router, Request, Response } from 'express';
import { PgObjectId } from '../models/PgModel';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import { authenticate } from '../middleware/authMiddleware';
import { requireTenant } from '../middleware/tenantMiddleware';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

// Global Search endpoint
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const rawQ = String(req.query.q || '').trim();

    if (!rawQ || rawQ.length < 1) {
      res.status(200).json([]);
      return;
    }

    // Strip prefix like "LND-" or "#" or "lnd-"
    const cleanQ = rawQ.replace(/^(lnd-|#)/i, '').trim();

    // Fetch all active modules for this organization
    const modules = await ModuleDefinition.find({ organizationId: orgId });
    const regex = new RegExp(cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const searchResults: any[] = [];

    for (const moduleDef of modules) {
      const matchConditions: any[] = [
        { 'data.firstName': regex },
        { 'data.lastName': regex },
        { 'data.phone': regex },
        { 'data.mobile': regex },
        { 'data.contactNumber': regex },
        { 'data.contact_num': regex },
        { 'data.contact': regex },
        { 'data.dataCode': regex },
        { 'data.data_code': regex },
        { 'data.allocatedNo': regex },
        { 'data.allocatedNumber': regex },
        { 'data.leadNo': regex },
        { 'data.company': regex },
        { 'data.firmName': regex },
        { 'data.firm': regex },
        { 'data.email': regex },
        { 'data.city': regex },
        { 'data.location': regex },
        { 'data.status': regex }
      ];

      // If cleanQ is valid ID, match exact _id
      if (PgObjectId.isValid(cleanQ)) {
        matchConditions.push({ _id: cleanQ });
      }

      // Match partial string or hex suffix of ID
      if (cleanQ.length >= 3 && /^[0-9a-fA-F-]+$/.test(cleanQ)) {
        matchConditions.push({ id: regex });
      }

      const records = await CustomRecord.find({
        organizationId: orgId,
        moduleId: moduleDef._id,
        $or: matchConditions
      })
        .sort({ updatedAt: -1 })
        .limit(10);

      if (records.length > 0) {
        searchResults.push({
          module: {
            _id: moduleDef._id,
            apiPath: moduleDef.apiPath,
            pluralLabel: moduleDef.pluralLabel,
            singularLabel: moduleDef.singularLabel,
            icon: moduleDef.icon || 'Layers'
          },
          records
        });
      }
    }

    res.status(200).json(searchResults);
  } catch (error) {
    console.error('Global Search Error:', error);
    res.status(500).json({ error: 'Failed to perform search.' });
  }
});

export default router;
