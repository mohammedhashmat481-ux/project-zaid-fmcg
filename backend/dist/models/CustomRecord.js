"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PgModel_1 = require("./PgModel");
const mappings = [
    { dbColumn: 'id', jsField: 'id' },
    { dbColumn: 'organization_id', jsField: 'organizationId' },
    { dbColumn: 'module_id', jsField: 'moduleId' },
    { dbColumn: 'data', jsField: 'data', isJson: true },
    { dbColumn: 'created_by', jsField: 'createdBy' },
    { dbColumn: 'updated_by', jsField: 'updatedBy' },
    { dbColumn: 'created_at', jsField: 'createdAt' },
    { dbColumn: 'updated_at', jsField: 'updatedAt' }
];
const CustomRecordModel = (0, PgModel_1.createPgModel)('custom_records', mappings);
exports.default = CustomRecordModel;
