import { createPgModel, FieldMapping } from './PgModel';

export interface INotification {
  _id?: string;
  id?: string;
  organizationId: any;
  userId: any;
  title: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  isRead?: boolean;
  link?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const mappings: FieldMapping[] = [
  { dbColumn: 'id', jsField: 'id' },
  { dbColumn: 'organization_id', jsField: 'organizationId' },
  { dbColumn: 'user_id', jsField: 'userId' },
  { dbColumn: 'title', jsField: 'title' },
  { dbColumn: 'message', jsField: 'message' },
  { dbColumn: 'type', jsField: 'type' },
  { dbColumn: 'is_read', jsField: 'isRead' },
  { dbColumn: 'link', jsField: 'link' },
  { dbColumn: 'created_at', jsField: 'createdAt' },
  { dbColumn: 'updated_at', jsField: 'updatedAt' }
];

const NotificationModel = createPgModel('notifications', mappings);
export default NotificationModel;
