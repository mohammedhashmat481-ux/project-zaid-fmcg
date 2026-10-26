"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PgModel_1 = require("./PgModel");
const mappings = [
    { dbColumn: 'id', jsField: 'id' },
    { dbColumn: 'organization_id', jsField: 'organizationId' },
    { dbColumn: 'user_id', jsField: 'userId' },
    { dbColumn: 'action', jsField: 'action' },
    { dbColumn: 'resource', jsField: 'resource' },
    { dbColumn: 'resource_id', jsField: 'resourceId' },
    { dbColumn: 'old_value', jsField: 'oldValue', isJson: true },
    { dbColumn: 'new_value', jsField: 'newValue', isJson: true },
    { dbColumn: 'ip_address', jsField: 'ipAddress' },
    { dbColumn: 'user_agent', jsField: 'userAgent' },
    { dbColumn: 'browser', jsField: 'browser' },
    { dbColumn: 'device', jsField: 'device' },
    { dbColumn: 'created_at', jsField: 'createdAt' }
];
const AuditLogModel = (0, PgModel_1.createPgModel)('audit_logs', mappings);
exports.default = AuditLogModel;
