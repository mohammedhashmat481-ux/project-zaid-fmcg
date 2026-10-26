"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PgModel_1 = require("./PgModel");
const mappings = [
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
const RoleModel = (0, PgModel_1.createPgModel)('roles', mappings);
exports.default = RoleModel;
