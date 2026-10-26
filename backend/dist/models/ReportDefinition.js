"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PgModel_1 = require("./PgModel");
const mappings = [
    { dbColumn: 'id', jsField: 'id' },
    { dbColumn: 'organization_id', jsField: 'organizationId' },
    { dbColumn: 'module_id', jsField: 'moduleId' },
    { dbColumn: 'name', jsField: 'name' },
    { dbColumn: 'description', jsField: 'description' },
    { dbColumn: 'chart_type', jsField: 'chartType' },
    { dbColumn: 'group_by_field', jsField: 'groupByField' },
    { dbColumn: 'metric_field', jsField: 'metricField' },
    { dbColumn: 'aggregation', jsField: 'aggregation' },
    { dbColumn: 'filters', jsField: 'filters', isJson: true },
    { dbColumn: 'columns', jsField: 'columns', isJson: true },
    { dbColumn: 'created_by', jsField: 'createdBy' },
    { dbColumn: 'created_at', jsField: 'createdAt' },
    { dbColumn: 'updated_at', jsField: 'updatedAt' }
];
const ReportDefinitionModel = (0, PgModel_1.createPgModel)('report_definitions', mappings);
exports.default = ReportDefinitionModel;
