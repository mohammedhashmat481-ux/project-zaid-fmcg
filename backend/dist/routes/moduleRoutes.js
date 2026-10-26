"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const router = (0, express_1.Router)();
// Apply auth & tenant isolation to all module definitions routes
router.use(authMiddleware_1.authenticate);
router.use(tenantMiddleware_1.requireTenant);
// 1. Get all module definitions active for the tenant
router.get('/', async (req, res) => {
    try {
        const modules = await ModuleDefinition_1.default.find({ organizationId: req.organizationId });
        res.status(200).json(modules);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to retrieve module layouts.' });
    }
});
// 2. Create a new custom module definition
router.post('/', async (req, res) => {
    try {
        const { name, singularLabel, pluralLabel, apiPath, icon, fields, relationships } = req.body;
        if (!name || !singularLabel || !pluralLabel || !apiPath) {
            res.status(400).json({ error: 'Name, Labels, and apiPath are required.' });
            return;
        }
        // Check for duplicate path inside same tenant
        const pathTaken = await ModuleDefinition_1.default.findOne({
            organizationId: req.organizationId,
            apiPath: apiPath.toLowerCase()
        });
        if (pathTaken) {
            res.status(400).json({ error: `An active module already uses path: ${apiPath}` });
            return;
        }
        const newModule = await ModuleDefinition_1.default.create({
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
        res.status(201).json(newModule);
    }
    catch (error) {
        console.error('Create Module Error:', error);
        res.status(500).json({ error: error.message || 'Failed to create module.' });
    }
});
// 3. Update an existing module definition (add fields, change labels)
router.put('/:id', async (req, res) => {
    try {
        const { singularLabel, pluralLabel, icon, fields, relationships } = req.body;
        const moduleDef = await ModuleDefinition_1.default.findOne({
            _id: req.params.id,
            organizationId: req.organizationId
        });
        if (!moduleDef) {
            res.status(404).json({ error: 'Module definition not found.' });
            return;
        }
        // Do not allow changing path to avoid API breakage
        if (singularLabel)
            moduleDef.singularLabel = singularLabel;
        if (pluralLabel)
            moduleDef.pluralLabel = pluralLabel;
        if (icon)
            moduleDef.icon = icon;
        if (fields)
            moduleDef.fields = fields;
        if (relationships)
            moduleDef.relationships = relationships;
        await moduleDef.save();
        res.status(200).json(moduleDef);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update module.' });
    }
});
// 4. Delete module definition
router.delete('/:id', async (req, res) => {
    try {
        const moduleDef = await ModuleDefinition_1.default.findOne({
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
        await CustomRecord_1.default.deleteMany({
            organizationId: req.organizationId,
            moduleId: moduleDef._id
        });
        // Delete the module definition
        await ModuleDefinition_1.default.findByIdAndDelete(moduleDef._id);
        res.status(200).json({ message: 'Module definition and all associated records deleted successfully.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete module.' });
    }
});
exports.default = router;
