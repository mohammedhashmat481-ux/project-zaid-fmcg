import { createPgModel, FieldMapping } from './PgModel';

export interface IReportFilter {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'between';
  value: string;
}

export interface IReportDefinition {
  _id?: string;
  id?: string;
  organizationId: any;
  moduleId: any;
  name: string;
  description?: string;
  chartType: 'bar' | 'line' | 'pie' | 'donut' | 'table' | 'pivot';
  groupByField?: string;
  metricField?: string;
  aggregation?: 'count' | 'sum' | 'avg' | 'min' | 'max';
  filters?: IReportFilter[];
  columns?: string[];
  createdBy: any;
  createdAt?: Date;
  updatedAt?: Date;
}

const mappings: FieldMapping[] = [
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

const ReportDefinitionModel = createPgModel('report_definitions', mappings);
export default ReportDefinitionModel;
