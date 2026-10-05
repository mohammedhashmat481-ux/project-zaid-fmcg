import { createPgModel, FieldMapping } from './PgModel';

export interface IFieldDefinition {
  name: string;
  label: string;
  type: string;
  required: boolean;
  unique: boolean;
  regexValidation?: string;
  defaultValue?: string;
  formulaExpression?: string;
  options?: string[];
  conditionalVisibility?: {
    dependsOnField: string;
    conditionValue: string;
  };
}

export interface IRelationshipDefinition {
  targetModule: string;
  type: 'one-to-many' | 'many-to-one' | 'many-to-many';
  fieldName: string;
}

export interface IModuleDefinition {
  _id?: string;
  id?: string;
  organizationId: any;
  name: string;
  singularLabel: string;
  pluralLabel: string;
  apiPath: string;
  icon: string;
  description?: string;
  isSystem: boolean;
  fields: IFieldDefinition[];
  relationships: IRelationshipDefinition[];
  createdAt?: Date;
  updatedAt?: Date;
}

const mappings: FieldMapping[] = [
  { dbColumn: 'id', jsField: 'id' },
  { dbColumn: 'organization_id', jsField: 'organizationId' },
  { dbColumn: 'name', jsField: 'name' },
  { dbColumn: 'singular_label', jsField: 'singularLabel' },
  { dbColumn: 'plural_label', jsField: 'pluralLabel' },
  { dbColumn: 'api_path', jsField: 'apiPath' },
  { dbColumn: 'icon', jsField: 'icon' },
  { dbColumn: 'description', jsField: 'description' },
  { dbColumn: 'is_system', jsField: 'isSystem' },
  { dbColumn: 'fields', jsField: 'fields', isJson: true },
  { dbColumn: 'relationships', jsField: 'relationships', isJson: true },
  { dbColumn: 'created_at', jsField: 'createdAt' },
  { dbColumn: 'updated_at', jsField: 'updatedAt' }
];

const ModuleDefinitionModel = createPgModel('module_definitions', mappings);
export default ModuleDefinitionModel;
