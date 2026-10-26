"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Workflow_1 = __importDefault(require("../models/Workflow"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authenticate);
router.use(tenantMiddleware_1.requireTenant);
// 1. Get all workflows for tenant
router.get('/', async (req, res) => {
    try {
        const workflows = await Workflow_1.default.find({ organizationId: req.organizationId });
        res.status(200).json(workflows);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to retrieve workflows.' });
    }
});
// 2. Create workflow
router.post('/', async (req, res) => {
    try {
        const { name, moduleId, trigger, conditions, actions, isEnabled } = req.body;
        if (!name || !moduleId || !trigger || !actions) {
            res.status(400).json({ error: 'Name, moduleId, trigger, and actions are required.' });
            return;
        }
        const workflow = await Workflow_1.default.create({
            organizationId: req.organizationId,
            moduleId,
            name,
            trigger,
            conditions: conditions || [],
            actions: actions || [],
            isEnabled: isEnabled !== undefined ? isEnabled : true
        });
        res.status(201).json(workflow);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create workflow.' });
    }
});
// 3. Update workflow
router.put('/:id', async (req, res) => {
    try {
        const { name, trigger, conditions, actions, isEnabled } = req.body;
        const workflow = await Workflow_1.default.findOne({
            _id: req.params.id,
            organizationId: req.organizationId
        });
        if (!workflow) {
            res.status(404).json({ error: 'Workflow not found.' });
            return;
        }
        if (name)
            workflow.name = name;
        if (trigger)
            workflow.trigger = trigger;
        if (conditions)
            workflow.conditions = conditions;
        if (actions)
            workflow.actions = actions;
        if (isEnabled !== undefined)
            workflow.isEnabled = isEnabled;
        await workflow.save();
        res.status(200).json(workflow);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update workflow.' });
    }
});
// 4. Delete workflow
router.delete('/:id', async (req, res) => {
    try {
        const workflow = await Workflow_1.default.findOneAndDelete({
            _id: req.params.id,
            organizationId: req.organizationId
        });
        if (!workflow) {
            res.status(404).json({ error: 'Workflow not found.' });
            return;
        }
        res.status(200).json({ message: 'Workflow deleted successfully.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete workflow.' });
    }
});
exports.default = router;
