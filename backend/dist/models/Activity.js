"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PgModel_1 = require("./PgModel");
const mappings = [
    { dbColumn: 'id', jsField: 'id' },
    { dbColumn: 'organization_id', jsField: 'organizationId' },
    { dbColumn: 'record_id', jsField: 'recordId' },
    { dbColumn: 'user_id', jsField: 'userId' },
    { dbColumn: 'type', jsField: 'type' },
    { dbColumn: 'details', jsField: 'details', isJson: true },
    { dbColumn: 'created_at', jsField: 'createdAt' }
];
const ActivityModel = (0, PgModel_1.createPgModel)('activities', mappings);
exports.default = ActivityModel;
