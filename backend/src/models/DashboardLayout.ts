import { createPgModel, FieldMapping } from './PgModel';

export interface IDashboardWidget {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, any>;
}

export interface IDashboardLayout {
  _id?: string;
  id?: string;
  organizationId: any;
  userId?: any;
  name: string;
  isDefault?: boolean;
  widgets?: IDashboardWidget[];
  createdAt?: Date;
  updatedAt?: Date;
}

const mappings: FieldMapping[] = [
  { dbColumn: 'id', jsField: 'id' },
  { dbColumn: 'organization_id', jsField: 'organizationId' },
  { dbColumn: 'user_id', jsField: 'userId' },
  { dbColumn: 'name', jsField: 'name' },
  { dbColumn: 'is_default', jsField: 'isDefault' },
  { dbColumn: 'widgets', jsField: 'widgets', isJson: true },
  { dbColumn: 'created_at', jsField: 'createdAt' },
  { dbColumn: 'updated_at', jsField: 'updatedAt' }
];

const DashboardLayoutModel = createPgModel('dashboard_layouts', mappings);
export default DashboardLayoutModel;
