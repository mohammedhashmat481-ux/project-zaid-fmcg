import { createPgModel, FieldMapping } from './PgModel';

export interface IDocument {
  _id?: string;
  id?: string;
  organizationId: any;
  name: string;
  filePath: string;
  mimeType: string;
  size: number;
  version?: number;
  uploadedBy: any;
  recordId?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

const mappings: FieldMapping[] = [
  { dbColumn: 'id', jsField: 'id' },
  { dbColumn: 'organization_id', jsField: 'organizationId' },
  { dbColumn: 'name', jsField: 'name' },
  { dbColumn: 'file_path', jsField: 'filePath' },
  { dbColumn: 'mime_type', jsField: 'mimeType' },
  { dbColumn: 'size', jsField: 'size' },
  { dbColumn: 'version', jsField: 'version' },
  { dbColumn: 'uploaded_by', jsField: 'uploadedBy' },
  { dbColumn: 'record_id', jsField: 'recordId' },
  { dbColumn: 'created_at', jsField: 'createdAt' },
  { dbColumn: 'updated_at', jsField: 'updatedAt' }
];

const DocumentModel = createPgModel('documents', mappings);
export default DocumentModel;
