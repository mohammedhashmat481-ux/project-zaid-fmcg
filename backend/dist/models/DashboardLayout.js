"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PgModel_1 = require("./PgModel");
const mappings = [
    { dbColumn: 'id', jsField: 'id' },
    { dbColumn: 'organization_id', jsField: 'organizationId' },
    { dbColumn: 'user_id', jsField: 'userId' },
    { dbColumn: 'name', jsField: 'name' },
    { dbColumn: 'is_default', jsField: 'isDefault' },
    { dbColumn: 'widgets', jsField: 'widgets', isJson: true },
    { dbColumn: 'created_at', jsField: 'createdAt' },
    { dbColumn: 'updated_at', jsField: 'updatedAt' }
];
const DashboardLayoutModel = (0, PgModel_1.createPgModel)('dashboard_layouts', mappings);
exports.default = DashboardLayoutModel;
