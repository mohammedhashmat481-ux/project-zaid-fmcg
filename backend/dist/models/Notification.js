"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PgModel_1 = require("./PgModel");
const mappings = [
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
const NotificationModel = (0, PgModel_1.createPgModel)('notifications', mappings);
exports.default = NotificationModel;
