import { Router, Request, Response } from 'express';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import { authenticate } from '../middleware/authMiddleware';
import { requireTenant } from '../middleware/tenantMiddleware';
import { serverCache, CacheKeys, CacheInvalidators } from '../utils/cache';

const router = Router();

// Apply auth & tenant isolation to all module definitions routes
router.use(authenticate);
router.use(requireTenant);

// 1. Get all module definitions active for the tenant
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const cacheKey = CacheKeys.modules(req.organizationId!);
    const cached = serverCache.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.status(200).json(cached);
      return;
    }

    const modules = await ModuleDefinition.find({ organizationId: req.organizationId });
    serverCache.set(cacheKey, modules, 600); // 10 minutes cache
    res.setHeader('X-Cache', 'MISS');
    res.status(200).json(modules);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve module layouts.' });
  }
});

// 2. Create a new custom module definition
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, singularLabel, pluralLabel, apiPath, icon, fields, relationships } = req.body;

    if (!name || !singularLabel || !pluralLabel || !apiPath) {
      res.status(400).json({ error: 'Name, Labels, and apiPath are required.' });
      return;
    }

    // Check for duplicate path inside same tenant
    const pathTaken = await ModuleDefinition.findOne({
      organizationId: req.organizationId,
      apiPath: apiPath.toLowerCase()
    });

    if (pathTaken) {
      res.status(400).json({ error: `An active module already uses path: ${apiPath}` });
      return;
    }

    const newModule = await ModuleDefinition.create({
      organizationId: req.organizationId,
      name,
      singularLabel,
      pluralLabel,
      apiPath: apiPath.toLowerCase(),
      icon: icon || 'FileText',
      isSystem: false,
      fields: fields || [],
      relationships: relationships || []
    });

    CacheInvalidators.invalidateModules(req.organizationId!);
    res.status(201).json(newModule);
  } catch (error: any) {
    console.error('Create Module Error:', error);
    res.status(500).json({ error: error.message || 'Failed to create module.' });
  }
});

// 3. Update an existing module definition (add fields, change labels)
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { singularLabel, pluralLabel, icon, fields, relationships } = req.body;

    const moduleDef = await ModuleDefinition.findOne({
      _id: req.params.id,
      organizationId: req.organizationId
    });

    if (!moduleDef) {
      res.status(404).json({ error: 'Module definition not found.' });
      return;
    }

    // Do not allow changing path to avoid API breakage
    if (singularLabel) moduleDef.singularLabel = singularLabel;
    if (pluralLabel) moduleDef.pluralLabel = pluralLabel;
    if (icon) moduleDef.icon = icon;
    if (fields) moduleDef.fields = fields;
    if (relationships) moduleDef.relationships = relationships;

    await moduleDef.save();
    CacheInvalidators.invalidateModules(req.organizationId!);
    res.status(200).json(moduleDef);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update module.' });
  }
});

// 4. Delete module definition
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const moduleDef = await ModuleDefinition.findOne({
      _id: req.params.id,
      organizationId: req.organizationId
    });

    if (!moduleDef) {
      res.status(404).json({ error: 'Module not found.' });
      return;
    }

    if (moduleDef.isSystem) {
      res.status(400).json({ error: 'System-defined modules cannot be deleted.' });
      return;
    }

    // Delete all CustomRecords belonging to this module in the organization
    await CustomRecord.deleteMany({
      organizationId: req.organizationId,
      moduleId: moduleDef._id
    });

    // Delete the module definition
    await ModuleDefinition.findByIdAndDelete(moduleDef._id);
    CacheInvalidators.invalidateModules(req.organizationId!);
    CacheInvalidators.invalidateMaster(req.organizationId!);

    res.status(200).json({ message: 'Module definition and all associated records deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete module.' });
  }
});

export default router;
