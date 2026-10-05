import { createPgModel, FieldMapping } from './PgModel';

export interface IAuditLog {
  _id?: string;
  id?: string;
  organizationId: any;
  userId: any;
  action: string;
  resource: string;
  resourceId?: string;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string;
  userAgent?: string;
  browser?: string;
  device?: string;
  createdAt?: Date;
}

const mappings: FieldMapping[] = [
  { dbColumn: 'id', jsField: 'id' },
  { dbColumn: 'organization_id', jsField: 'organizationId' },
  { dbColumn: 'user_id', jsField: 'userId' },
  { dbColumn: 'action', jsField: 'action' },
  { dbColumn: 'resource', jsField: 'resource' },
  { dbColumn: 'resource_id', jsField: 'resourceId' },
  { dbColumn: 'old_value', jsField: 'oldValue', isJson: true },
  { dbColumn: 'new_value', jsField: 'newValue', isJson: true },
  { dbColumn: 'ip_address', jsField: 'ipAddress' },
  { dbColumn: 'user_agent', jsField: 'userAgent' },
  { dbColumn: 'browser', jsField: 'browser' },
  { dbColumn: 'device', jsField: 'device' },
  { dbColumn: 'created_at', jsField: 'createdAt' }
];

const AuditLogModel = createPgModel('audit_logs', mappings);
export default AuditLogModel;
