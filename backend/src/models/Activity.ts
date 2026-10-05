import { createPgModel, FieldMapping } from './PgModel';

export interface IActivity {
  _id?: string;
  id?: string;
  organizationId: any;
  recordId: any;
  userId: any;
  type: 'create' | 'edit' | 'delete' | 'comment' | 'mention' | 'attachment' | 'status_change' | 'assignment';
  details: {
    fieldName?: string;
    oldValue?: any;
    newValue?: any;
    commentText?: string;
    attachmentUrl?: string;
    assignedToId?: any;
  };
  createdAt?: Date;
}

const mappings: FieldMapping[] = [
  { dbColumn: 'id', jsField: 'id' },
  { dbColumn: 'organization_id', jsField: 'organizationId' },
  { dbColumn: 'record_id', jsField: 'recordId' },
  { dbColumn: 'user_id', jsField: 'userId' },
  { dbColumn: 'type', jsField: 'type' },
  { dbColumn: 'details', jsField: 'details', isJson: true },
  { dbColumn: 'created_at', jsField: 'createdAt' }
];

const ActivityModel = createPgModel('activities', mappings);
export default ActivityModel;
