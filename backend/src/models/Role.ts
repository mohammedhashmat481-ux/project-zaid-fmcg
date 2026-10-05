import { createPgModel, FieldMapping } from './PgModel';

export interface IModulePermission {
  moduleName: string;
  create: boolean;
  read: 'all' | 'own' | 'none';
  update: 'all' | 'own' | 'none';
  delete: 'all' | 'own' | 'none';
}

export interface IFieldPermission {
  moduleName: string;
  fieldName: string;
  access: 'read' | 'write' | 'none';
}

export interface IRole {
  _id?: string;
  id?: string;
  organizationId: any;
  name: string;
  description?: string;
  isSystem?: boolean;
  permissions?: {
    modules: IModulePermission[];
    fields: IFieldPermission[];
    menus: string[];
  };
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const mappings: FieldMapping[] = [
  { dbColumn: 'id', jsField: 'id' },
  { dbColumn: 'organization_id', jsField: 'organizationId' },
  { dbColumn: 'name', jsField: 'name' },
  { dbColumn: 'description', jsField: 'description' },
  { dbColumn: 'is_system', jsField: 'isSystem' },
  { dbColumn: 'permissions', jsField: 'permissions', isJson: true },
  { dbColumn: 'is_active', jsField: 'isActive' },
  { dbColumn: 'created_at', jsField: 'createdAt' },
  { dbColumn: 'updated_at', jsField: 'updatedAt' }
];

const RoleModel = createPgModel('roles', mappings);
export default RoleModel;
