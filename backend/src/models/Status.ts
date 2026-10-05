import { createPgModel, FieldMapping } from './PgModel';

export interface IStatus {
  _id?: string;
  id?: string;
  organizationId: any;
  name: string;
  color: string;
  icon: string;
  pipelinePosition?: number;
  dashboardVisibility?: boolean;
  isFinal?: boolean;
  isSuccess?: boolean;
  order?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const mappings: FieldMapping[] = [
  { dbColumn: 'id', jsField: 'id' },
  { dbColumn: 'organization_id', jsField: 'organizationId' },
  { dbColumn: 'name', jsField: 'name' },
  { dbColumn: 'color', jsField: 'color' },
  { dbColumn: 'icon', jsField: 'icon' },
  { dbColumn: 'pipeline_position', jsField: 'pipelinePosition' },
  { dbColumn: 'dashboard_visibility', jsField: 'dashboardVisibility' },
  { dbColumn: 'is_final', jsField: 'isFinal' },
  { dbColumn: 'is_success', jsField: 'isSuccess' },
  { dbColumn: 'order_num', jsField: 'order' },
  { dbColumn: 'created_at', jsField: 'createdAt' },
  { dbColumn: 'updated_at', jsField: 'updatedAt' }
];

const StatusModel = createPgModel('statuses', mappings);
export default StatusModel;
