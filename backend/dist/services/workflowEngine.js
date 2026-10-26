"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowEngine = void 0;
const Workflow_1 = __importDefault(require("../models/Workflow"));
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
const Notification_1 = __importDefault(require("../models/Notification"));
const PgModel_1 = require("../models/PgModel");
class WorkflowEngine {
    /**
     * Triggers workflows for a specific module event.
     */
    static async trigger(organizationId, moduleId, event, record, // The record document/data
    changedFields = []) {
        try {
            // Find all active workflows for this module and event
            const workflows = await Workflow_1.default.find({
                organizationId,
                $or: [
                    { moduleId },
                    { 'trigger.module': moduleId }
                ],
                isEnabled: true,
                'trigger.event': event
            });
            for (const workflow of workflows) {
                // If trigger has fieldTrigger defined, check if that field actually changed
                if (event === 'update' && workflow.trigger.fieldTrigger) {
                    if (!changedFields.includes(workflow.trigger.fieldTrigger)) {
                        continue; // Skip this workflow since the trigger field didn't change
                    }
                }
                // Evaluate conditions
                const match = this.evaluateConditions(record, workflow.conditions);
                if (match) {
                    console.log(`Workflow [${workflow.name}] matched! Running actions...`);
                    await this.executeActions(organizationId, workflow.actions, record);
                }
            }
        }
        catch (error) {
            console.error('Error in WorkflowEngine:', error);
        }
    }
    /**
     * Evaluates if record data satisfies workflow conditions.
     */
    static evaluateConditions(record, conditions) {
        if (!conditions || conditions.length === 0)
            return true;
        const data = record.data ? record.data : record;
        return conditions.every((cond) => {
            // Map schema fields. Standard custom records store values in the `data` Map.
            let val = data instanceof Map ? data.get(cond.field) : data[cond.field];
            if (val === undefined || val === null) {
                return cond.operator === 'not_equals'; // Null satisfies "not equals" to a value
            }
            const condValue = cond.value;
            switch (cond.operator) {
                case 'equals':
                    return String(val).toLowerCase() === condValue.toLowerCase();
                case 'not_equals':
                    return String(val).toLowerCase() !== condValue.toLowerCase();
                case 'greater_than':
                    return Number(val) > Number(condValue);
                case 'less_than':
                    return Number(val) < Number(condValue);
                case 'contains':
                    return String(val).toLowerCase().includes(condValue.toLowerCase());
                default:
                    return false;
            }
        });
    }
    /**
     * Executes a workflow action pipeline.
     */
    static async executeActions(organizationId, actions, record) {
        for (const action of actions) {
            try {
                if (action.delayMinutes && action.delayMinutes > 0) {
                    // Mock delay execution
                    console.log(`Action ${action.type} scheduled with a delay of ${action.delayMinutes} mins.`);
                    // In production, push to a job queue like BullMQ. For self-contained runtime, execute via setTimeout.
                    setTimeout(() => {
                        this.runAction(organizationId, action, record);
                    }, action.delayMinutes * 60 * 1000);
                }
                else {
                    await this.runAction(organizationId, action, record);
                }
            }
            catch (err) {
                console.error(`Failed to execute workflow action: ${action.type}`, err);
            }
        }
    }
    /**
     * Runs an individual action.
     */
    static async runAction(organizationId, action, record) {
        const params = action.params instanceof Map ? Object.fromEntries(action.params) : action.params;
        switch (action.type) {
            case 'notification': {
                // Create in-app notification
                // Find recipient: default to record owner/creator, or specific user
                const userId = record.createdBy || params.userId;
                if (userId) {
                    await Notification_1.default.create({
                        organizationId,
                        userId,
                        title: params.title || 'Workflow Alert',
                        message: params.message || 'Workflow executed successfully.',
                        type: 'info'
                    });
                }
                break;
            }
            case 'create_task': {
                // Dynamically locate the "Tasks" module configuration for this tenant
                const taskModule = await ModuleDefinition_1.default.findOne({
                    organizationId,
                    apiPath: 'tasks'
                });
                if (taskModule) {
                    // Insert a new task CustomRecord
                    await CustomRecord_1.default.create({
                        organizationId,
                        moduleId: taskModule._id,
                        data: {
                            title: params.title || 'Follow up Task',
                            description: params.description || 'Auto-created by workflow.',
                            status: 'Pending',
                            priority: params.priority || 'Medium',
                            dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
                            relatedTo: record._id
                        },
                        createdBy: record.createdBy || new PgModel_1.PgObjectId().toString(), // fallbacks
                        updatedBy: record.createdBy || new PgModel_1.PgObjectId().toString()
                    });
                    console.log('Task automatically created by workflow trigger.');
                }
                else {
                    console.warn('Could not trigger create_task workflow: Tasks module not found.');
                }
                break;
            }
            case 'assign_user': {
                const userId = params.userId;
                if (userId && PgModel_1.PgObjectId.isValid(userId)) {
                    // Update the custom record's data map
                    await CustomRecord_1.default.findByIdAndUpdate(record._id, {
                        $set: { 'data.assignedTo': String(userId) }
                    });
                    console.log(`Record ${record._id} assigned to user ${userId}.`);
                }
                break;
            }
            case 'webhook': {
                const webhookUrl = params.url;
                if (webhookUrl) {
                    console.log(`Sending webhook to: ${webhookUrl}`);
                    fetch(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            event: 'workflow_trigger',
                            recordId: record._id,
                            data: record.data
                        })
                    }).catch((err) => console.error('Webhook fetch failed:', err.message));
                }
                break;
            }
            case 'send_email': {
                // Mock email sending
                console.log(`[MOCK EMAIL] To: ${params.to || 'owner'}, Subject: ${params.subject}`);
                break;
            }
            default:
                console.warn('Unknown workflow action type:', action.type);
        }
    }
}
exports.WorkflowEngine = WorkflowEngine;
