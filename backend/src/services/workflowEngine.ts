import Workflow, { IWorkflow, IWorkflowCondition, IWorkflowAction } from '../models/Workflow';
import CustomRecord from '../models/CustomRecord';
import ModuleDefinition from '../models/ModuleDefinition';
import Notification from '../models/Notification';
import { PgObjectId } from '../models/PgModel';

export class WorkflowEngine {
  /**
   * Triggers workflows for a specific module event.
   */
  public static async trigger(
    organizationId: any,
    moduleId: any,
    event: 'create' | 'update' | 'delete',
    record: any, // The record document/data
    changedFields: string[] = []
  ): Promise<void> {
    try {
      // Find all active workflows for this module and event
      const workflows = await Workflow.find({
        organizationId,
        moduleId,
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
          // Run actions asynchronously in background
          this.executeActions(organizationId, workflow.actions, record);
        }
      }
    } catch (error) {
      console.error('Error in WorkflowEngine:', error);
    }
  }

  /**
   * Evaluates if record data satisfies workflow conditions.
   */
  private static evaluateConditions(record: any, conditions: IWorkflowCondition[]): boolean {
    if (!conditions || conditions.length === 0) return true;

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
  private static async executeActions(
    organizationId: any,
    actions: IWorkflowAction[],
    record: any
  ): Promise<void> {
    for (const action of actions) {
      try {
        if (action.delayMinutes && action.delayMinutes > 0) {
          // Mock delay execution
          console.log(`Action ${action.type} scheduled with a delay of ${action.delayMinutes} mins.`);
          // In production, push to a job queue like BullMQ. For self-contained runtime, execute via setTimeout.
          setTimeout(() => {
            this.runAction(organizationId, action, record);
          }, action.delayMinutes * 60 * 1000);
        } else {
          await this.runAction(organizationId, action, record);
        }
      } catch (err) {
        console.error(`Failed to execute workflow action: ${action.type}`, err);
      }
    }
  }

  /**
   * Runs an individual action.
   */
  private static async runAction(
    organizationId: any,
    action: IWorkflowAction,
    record: any
  ): Promise<void> {
    const params = action.params instanceof Map ? Object.fromEntries(action.params) : action.params;

    switch (action.type) {
      case 'notification': {
        // Create in-app notification
        // Find recipient: default to record owner/creator, or specific user
        const userId = record.createdBy || params.userId;
        if (userId) {
          await Notification.create({
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
        const taskModule = await ModuleDefinition.findOne({
          organizationId,
          apiPath: 'tasks'
        });

        if (taskModule) {
          // Insert a new task CustomRecord
          await CustomRecord.create({
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
            createdBy: record.createdBy || new PgObjectId().toString(), // fallbacks
            updatedBy: record.createdBy || new PgObjectId().toString()
          });
          console.log('Task automatically created by workflow trigger.');
        } else {
          console.warn('Could not trigger create_task workflow: Tasks module not found.');
        }
        break;
      }

      case 'assign_user': {
        const userId = params.userId;
        if (userId && PgObjectId.isValid(userId)) {
          // Update the custom record's data map
          await CustomRecord.findByIdAndUpdate(record._id, {
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
