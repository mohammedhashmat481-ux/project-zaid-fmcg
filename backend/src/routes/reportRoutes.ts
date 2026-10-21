import { Router, Request, Response } from 'express';
import ReportDefinition from '../models/ReportDefinition';
import ModuleDefinition from '../models/ModuleDefinition';
import { ReportBuilderService } from '../services/reportBuilder';
import { authenticate } from '../middleware/authMiddleware';
import { requireTenant } from '../middleware/tenantMiddleware';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

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
