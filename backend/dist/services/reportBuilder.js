"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportBuilderService = void 0;
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
const hierarchy_1 = require("../utils/hierarchy");
class ReportBuilderService {
    /**
     * Evaluates a report definition and returns aggregated summary data.
     */
    static async generateReport(report, reqUser) {
        const pipeline = [];
        // 1. Initial Match for Organization and Module
        const matchStage = {
            organizationId: report.organizationId,
            moduleId: report.moduleId
        };
        if (reqUser) {
            await hierarchy_1.HierarchyService.modifyRecordQuery(matchStage, reqUser, report.organizationId);
        }
        // 2. Map filters to pipeline match stages
        // Custom record dynamic fields are nested inside `data.<fieldName>`
        if (report.filters && report.filters.length > 0) {
            report.filters.forEach((filter) => {
                const key = `data.${filter.field}`;
                switch (filter.operator) {
                    case 'equals':
                        matchStage[key] = filter.value;
                        break;
                    case 'not_equals':
                        matchStage[key] = { $ne: filter.value };
                        break;
                    case 'greater_than':
                        matchStage[key] = { $gt: isNaN(Number(filter.value)) ? filter.value : Number(filter.value) };
                        break;
                    case 'less_than':
                        matchStage[key] = { $lt: isNaN(Number(filter.value)) ? filter.value : Number(filter.value) };
                        break;
                    case 'contains':
                        matchStage[key] = { $regex: filter.value, $options: 'i' };
                        break;
                    case 'between': {
                        const parts = filter.value.split(',');
                        if (parts.length === 2) {
                            const start = isNaN(Number(parts[0])) ? parts[0] : Number(parts[0]);
                            const end = isNaN(Number(parts[1])) ? parts[1] : Number(parts[1]);
                            matchStage[key] = { $gte: start, $lte: end };
                        }
                        break;
                    }
                }
            });
        }
        pipeline.push({ $match: matchStage });
        // 3. Setup Aggregation Group Stage
        // Grouping by a custom field e.g. status, industry, gradeLevel
        const groupField = report.groupByField ? `$data.${report.groupByField}` : null;
        const metricField = report.metricField ? `$data.${report.metricField}` : null;
        let groupAccumulator = { $sum: 1 }; // Default: count matching records
        if (report.metricField && report.aggregation !== 'count') {
            // Map math aggregation functions. Uses $toDouble to parse strings if necessary
            const numericFieldExpr = {
                $cond: {
                    if: { $isNumber: metricField },
                    then: metricField,
                    else: { $convert: { input: metricField, to: 'double', onError: 0, onNull: 0 } }
                }
            };
            switch (report.aggregation) {
                case 'sum':
                    groupAccumulator = { $sum: numericFieldExpr };
                    break;
                case 'avg':
                    groupAccumulator = { $avg: numericFieldExpr };
                    break;
                case 'min':
                    groupAccumulator = { $min: numericFieldExpr };
                    break;
                case 'max':
                    groupAccumulator = { $max: numericFieldExpr };
                    break;
            }
        }
        pipeline.push({
            $group: {
                _id: groupField,
                value: groupAccumulator
            }
        });
        // 4. Project Stage to format output cleanly
        pipeline.push({
            $project: {
                _id: 0,
                label: { $ifNull: ['$_id', 'Unassigned'] },
                value: 1
            }
        });
        // 5. Sort by label ascending
        pipeline.push({ $sort: { label: 1 } });
        // Execute aggregation
        return await CustomRecord_1.default.aggregate(pipeline);
    }
    /**
     * Fetches raw rows for detailed table report display.
     */
    static async getReportDetails(report, reqUser) {
        const query = {
            organizationId: report.organizationId,
            moduleId: report.moduleId
        };
        if (reqUser) {
            await hierarchy_1.HierarchyService.modifyRecordQuery(query, reqUser, report.organizationId);
        }
        if (report.filters && report.filters.length > 0) {
            report.filters.forEach((filter) => {
                const key = `data.${filter.field}`;
                switch (filter.operator) {
                    case 'equals':
                        query[key] = filter.value;
                        break;
                    case 'not_equals':
                        query[key] = { $ne: filter.value };
                        break;
                    case 'greater_than':
                        query[key] = { $gt: isNaN(Number(filter.value)) ? filter.value : Number(filter.value) };
                        break;
                    case 'less_than':
                        query[key] = { $lt: isNaN(Number(filter.value)) ? filter.value : Number(filter.value) };
                        break;
                    case 'contains':
                        query[key] = { $regex: filter.value, $options: 'i' };
                        break;
                }
            });
        }
        // Projects only configured columns
        const projection = { createdAt: 1, updatedAt: 1 };
        if (report.columns && report.columns.length > 0) {
            report.columns.forEach((col) => {
                projection[`data.${col}`] = 1;
            });
        }
        else {
            projection.data = 1;
        }
        return await CustomRecord_1.default.find(query, projection).sort({ createdAt: -1 }).limit(100);
    }
}
exports.ReportBuilderService = ReportBuilderService;
