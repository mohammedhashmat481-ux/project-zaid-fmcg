"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PgModel_1 = require("./PgModel");
const mappings = [
    { dbColumn: 'id', jsField: 'id' },
    { dbColumn: 'organization_id', jsField: 'organizationId' },
    { dbColumn: 'name', jsField: 'name' },
    { dbColumn: 'color', jsField: 'color' },
    { dbColumn: 'icon', jsField: 'icon' },
    { dbColumn: 'pipeline_position', jsField: 'pipelinePosition' },
    { dbColumn: 'dashboard_visibility', jsField: 'dashboardVisibility' },
    { dbColumn: 'is_final', jsField: 'isFinal' },
    { dbColumn: 'is_success', jsField: 'isSuccess' },
    { dbColumn: 'order_num', jsField: 'order' },
    { dbColumn: 'created_at', jsField: 'createdAt' },
    { dbColumn: 'updated_at', jsField: 'updatedAt' }
];
const StatusModel = (0, PgModel_1.createPgModel)('statuses', mappings);
exports.default = StatusModel;
