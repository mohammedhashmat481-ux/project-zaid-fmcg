"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PgModel_1 = require("./PgModel");
const mappings = [
    { dbColumn: 'id', jsField: 'id' },
    { dbColumn: 'organization_id', jsField: 'organizationId' },
    { dbColumn: 'module_id', jsField: 'moduleId' },
    { dbColumn: 'name', jsField: 'name' },
    { dbColumn: 'trigger', jsField: 'trigger', isJson: true },
    { dbColumn: 'conditions', jsField: 'conditions', isJson: true },
    { dbColumn: 'actions', jsField: 'actions', isJson: true },
    { dbColumn: 'is_enabled', jsField: 'isEnabled' },
    { dbColumn: 'created_at', jsField: 'createdAt' },
    { dbColumn: 'updated_at', jsField: 'updatedAt' }
];
const WorkflowModel = (0, PgModel_1.createPgModel)('workflows', mappings);
exports.default = WorkflowModel;
