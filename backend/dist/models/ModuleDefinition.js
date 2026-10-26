"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PgModel_1 = require("./PgModel");
const mappings = [
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
const ModuleDefinitionModel = (0, PgModel_1.createPgModel)('module_definitions', mappings);
exports.default = ModuleDefinitionModel;
