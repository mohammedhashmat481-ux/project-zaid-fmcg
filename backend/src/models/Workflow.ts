import { createPgModel, FieldMapping } from './PgModel';

export interface IWorkflowCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains';
  value: string;
}

export interface IWorkflowAction {
  type: 'assign_user' | 'send_email' | 'create_task' | 'webhook' | 'notification';
  params: Record<string, any>;
  delayMinutes?: number;
}

export interface IWorkflow {
  _id?: string;
  id?: string;
  organizationId: any;
  moduleId: any;
  name: string;
  trigger: {
    event: 'create' | 'update' | 'delete';
    fieldTrigger?: string;
  };
  conditions: IWorkflowCondition[];
  actions: IWorkflowAction[];
  isEnabled?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const mappings: FieldMapping[] = [
  { dbColumn: 'id', jsField: 'id' },
  { dbColumn: 'organization_id', jsField: 'organizationId' },
  { dbColumn: 'module_id', jsField: 'moduleId' },
  { dbColumn: 'name', jsField: 'name' },
  { dbColumn: 'trigger', jsField: 'trigger', isJson: true },
  { dbColumn: 'conditions', jsField: 'conditions', isJson: true },
  { dbColumn: 'actions', jsField: 'actions', isJson: true },
  { dbColumn: 'is_enabled', jsField: 'isEnabled' },
  { dbColumn: 'created_at', jsField: 'createdAt' },
  { dbColumn: 'updated_at', jsField: 'updatedAt' }
];

const WorkflowModel = createPgModel('workflows', mappings);
export default WorkflowModel;
