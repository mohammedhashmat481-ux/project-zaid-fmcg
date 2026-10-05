import { createPgModel, FieldMapping } from './PgModel';

export interface ICustomRecord {
  _id?: string;
  id?: string;
  organizationId: any;
  moduleId: any;
  data: Record<string, any>;
  createdBy: any;
  updatedBy: any;
  createdAt?: Date;
  updatedAt?: Date;
}

const mappings: FieldMapping[] = [
  { dbColumn: 'id', jsField: 'id' },
  { dbColumn: 'organization_id', jsField: 'organizationId' },
  { dbColumn: 'module_id', jsField: 'moduleId' },
  { dbColumn: 'data', jsField: 'data', isJson: true },
  { dbColumn: 'created_by', jsField: 'createdBy' },
  { dbColumn: 'updated_by', jsField: 'updatedBy' },
  { dbColumn: 'created_at', jsField: 'createdAt' },
  { dbColumn: 'updated_at', jsField: 'updatedAt' }
];

const CustomRecordModel = createPgModel('custom_records', mappings);
export default CustomRecordModel;
