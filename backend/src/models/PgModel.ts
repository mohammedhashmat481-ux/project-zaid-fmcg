import { queryPg } from '../config/postgres';

export class PgObjectId {
  private idStr: string;

  constructor(id?: any) {
    if (id instanceof PgObjectId) {
      this.idStr = id.idStr;
    } else if (typeof id === 'string' && id.trim()) {
      this.idStr = id.trim();
    } else if (id && typeof id === 'object' && (id._id || id.id)) {
      this.idStr = String(id._id || id.id);
    } else {
      const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
      const randomHex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      this.idStr = (timestamp + randomHex).toLowerCase();
    }
  }

  toString() { return this.idStr; }
  toHexString() { return this.idStr; }
  toJSON() { return this.idStr; }
  equals(other: any) {
    if (!other) return false;
    return String(this.idStr) === String(other);
  }

  static isValid(id: any): boolean {
    if (!id) return false;
    const s = String(id).trim();
    return /^[0-9a-fA-F]{24}$/.test(s) || /^[0-9a-fA-F-]{36}$/.test(s);
  }
}

export const createObjectId = (id?: any) => new PgObjectId(id);

export interface FieldMapping {
  dbColumn: string;
  jsField: string;
  isJson?: boolean;
}

export class PgQueryChain {
  private tableName: string;
  private mappings: FieldMapping[];
  private queryObj: any;
  private sortObj: any = null;
  private skipVal: number = 0;
  private limitVal: number | null = null;
  private isSingle: boolean = false;

  constructor(tableName: string, mappings: FieldMapping[], queryObj: any = {}, isSingle: boolean = false) {
    this.tableName = tableName;
    this.mappings = mappings;
    this.queryObj = queryObj || {};
    this.isSingle = isSingle;
    if (isSingle) {
      this.limitVal = 1;
    }
  }

  sort(sortArg: any) {
    this.sortObj = sortArg;
    return this;
  }

  skip(skipArg: number) {
    this.skipVal = Number(skipArg) || 0;
    return this;
  }

  limit(limitArg: number) {
    this.limitVal = Number(limitArg);
    return this;
  }

  select(fields?: any) {
    return this;
  }

  populate(arg?: any, selectFields?: any) {
    return this;
  }

  lean(arg?: boolean) {
    return this;
  }

  async exec(): Promise<any> {
    const res = await this.executeFind();
    return this.isSingle ? (res.length > 0 ? res[0] : null) : res;
  }

  then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    return this.exec().then(onfulfilled, onrejected);
  }

  private async executeFind(): Promise<any[]> {
    const { whereClause, params } = buildWhereClause(this.tableName, this.mappings, this.queryObj);
    let sql = `SELECT * FROM ${this.tableName} ${whereClause}`;

    if (this.sortObj) {
      const orderParts: string[] = [];
      if (typeof this.sortObj === 'string') {
        const desc = this.sortObj.startsWith('-');
        const fieldName = desc ? this.sortObj.substring(1) : this.sortObj;
        const col = mapJsToDbCol(this.tableName, this.mappings, fieldName);
        orderParts.push(`${col} ${desc ? 'DESC' : 'ASC'}`);
      } else if (typeof this.sortObj === 'object') {
        Object.keys(this.sortObj).forEach((k) => {
          const col = mapJsToDbCol(this.tableName, this.mappings, k);
          const dir = Number(this.sortObj[k]) < 0 ? 'DESC' : 'ASC';
          orderParts.push(`${col} ${dir}`);
        });
      }
      if (orderParts.length > 0) {
        sql += ` ORDER BY ${orderParts.join(', ')}`;
      }
    }

    if (this.limitVal !== null && this.limitVal > 0) {
      sql += ` LIMIT ${this.limitVal}`;
    }
    if (this.skipVal > 0) {
      sql += ` OFFSET ${this.skipVal}`;
    }

    const rows = await queryPg(sql, params);
    return rows.map((r: any) => mapDbToJs(this.tableName, this.mappings, r));
  }
}

export class PgModel {
  public tableName: string;
  public mappings: FieldMapping[];
  public dataData: any;

  constructor(tableName: string, mappings: FieldMapping[], initialData?: any) {
    this.tableName = tableName;
    this.mappings = mappings;
    this.dataData = initialData;

    if (initialData && typeof initialData === 'object') {
      Object.assign(this, initialData);
      if (!(this as any)._id) {
        (this as any)._id = new PgObjectId().toString();
      }
    }
  }

  async save(): Promise<any> {
    const doc: any = { ...this };
    delete doc.tableName;
    delete doc.mappings;
    delete doc.dataData;

    const existing = await this.findById(doc._id);
    if (existing) {
      await this.updateOne({ _id: doc._id }, doc);
      return this.findById(doc._id);
    } else {
      return this.create(doc);
    }
  }

  find(query: any = {}) {
    return new PgQueryChain(this.tableName, this.mappings, query, false);
  }

  findOne(query: any = {}) {
    return new PgQueryChain(this.tableName, this.mappings, query, true);
  }

  findById(id: any) {
    if (!id) return new PgQueryChain(this.tableName, this.mappings, { _id: '__none__' }, true);
    const cleanId = String(id._id || id).trim();
    return new PgQueryChain(this.tableName, this.mappings, { _id: cleanId }, true);
  }

  async create(data: any, options?: any): Promise<any> {
    if (Array.isArray(data)) {
      return this.insertMany(data);
    }

    const doc = { ...data };
    if (!doc._id && !doc.id) {
      doc._id = new PgObjectId().toString();
    } else {
      doc._id = String(doc._id || doc.id);
    }
    if (!doc.createdAt) doc.createdAt = new Date();
    if (!doc.updatedAt) doc.updatedAt = new Date();

    const dbObj = mapJsToDbRow(this.tableName, this.mappings, doc);
    const cols = Object.keys(dbObj);
    const vals = Object.values(dbObj);

    const paramPlaceholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const colNames = cols.join(', ');

    const sql = `INSERT INTO ${this.tableName} (${colNames}) VALUES (${paramPlaceholders}) RETURNING *`;
    const rows = await queryPg(sql, vals);
    return mapDbToJs(this.tableName, this.mappings, rows[0]);
  }

  async insertMany(docs: any[]): Promise<any[]> {
    if (!Array.isArray(docs) || docs.length === 0) return [];

    const results: any[] = [];
    for (const d of docs) {
      const created = await this.create(d);
      results.push(created);
    }
    return results;
  }

  async updateOne(query: any, updateDoc: any): Promise<{ modifiedCount: number }> {
    const target = await this.findOne(query);
    if (!target) return { modifiedCount: 0 };

    const updatedData = applyMongoUpdate(target, updateDoc);
    updatedData.updatedAt = new Date();

    const dbObj = mapJsToDbRow(this.tableName, this.mappings, updatedData);
    delete dbObj.id; // Primary key immutable

    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    Object.keys(dbObj).forEach((col) => {
      setClauses.push(`${col} = $${paramIdx}`);
      params.push(dbObj[col]);
      paramIdx++;
    });

    params.push(target._id);
    const sql = `UPDATE ${this.tableName} SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`;
    await queryPg(sql, params);

    return { modifiedCount: 1 };
  }

  async updateMany(query: any, updateDoc: any): Promise<{ modifiedCount: number }> {
    const targets = await this.find(query).exec();
    let modifiedCount = 0;
    for (const t of targets) {
      const res = await this.updateOne({ _id: t._id }, updateDoc);
      modifiedCount += res.modifiedCount;
    }
    return { modifiedCount };
  }

  async findByIdAndUpdate(id: any, updateDoc: any, options: any = { new: true }): Promise<any | null> {
    if (!id) return null;
    const cleanId = String(id._id || id).trim();
    await this.updateOne({ _id: cleanId }, updateDoc);
    return this.findById(cleanId);
  }

  async findOneAndUpdate(query: any, updateDoc: any, options: any = { new: true }): Promise<any | null> {
    const target = await this.findOne(query);
    if (!target) return null;
    await this.updateOne({ _id: target._id }, updateDoc);
    return this.findById(target._id);
  }

  async deleteOne(query: any): Promise<{ deletedCount: number }> {
    const target = await this.findOne(query);
    if (!target) return { deletedCount: 0 };

    const sql = `DELETE FROM ${this.tableName} WHERE id = $1`;
    await queryPg(sql, [target._id]);
    return { deletedCount: 1 };
  }

  async deleteMany(query: any): Promise<{ deletedCount: number }> {
    const { whereClause, params } = buildWhereClause(this.tableName, this.mappings, query);
    const countSql = `SELECT COUNT(*)::int as count FROM ${this.tableName} ${whereClause}`;
    const countRes = await queryPg(countSql, params);
    const count = countRes[0]?.count || 0;

    const deleteSql = `DELETE FROM ${this.tableName} ${whereClause}`;
    await queryPg(deleteSql, params);
    return { deletedCount: count };
  }

  async findByIdAndDelete(id: any): Promise<any | null> {
    if (!id) return null;
    const cleanId = String(id._id || id).trim();
    const existing = await this.findById(cleanId);
    if (!existing) return null;
    await this.deleteOne({ _id: cleanId });
    return existing;
  }

  async findOneAndDelete(query: any): Promise<any | null> {
    const existing = await this.findOne(query);
    if (!existing) return null;
    await this.deleteOne({ _id: existing._id });
    return existing;
  }

  async countDocuments(query: any = {}): Promise<number> {
    const { whereClause, params } = buildWhereClause(this.tableName, this.mappings, query);
    const sql = `SELECT COUNT(*)::int as count FROM ${this.tableName} ${whereClause}`;
    const rows = await queryPg(sql, params);
    return rows[0]?.count || 0;
  }

  async aggregate(pipeline: any[]): Promise<any[]> {
    return executeMongoAggregate(this.tableName, this.mappings, pipeline);
  }
}

// Helper factory for model instantiation
export function createPgModel(tableName: string, mappings: FieldMapping[]) {
  const modelConstructor = function (initialData?: any) {
    return new PgModel(tableName, mappings, initialData);
  };
  Object.setPrototypeOf(modelConstructor, new PgModel(tableName, mappings));
  return modelConstructor as any;
}

export function buildJsonPathExpr(col: string, pathParts: string[]): string {
  const safeCol = col.replace(/[^a-zA-Z0-9_]/g, '');
  if (!pathParts || pathParts.length === 0) return safeCol;

  let expr = safeCol;
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    const isLast = (i === pathParts.length - 1);
    const isIndex = /^\d+$/.test(part);
    const op = isLast ? '->>' : '->';

    if (isIndex) {
      expr = `${expr}${op}${part}`;
    } else {
      const safeKey = part.replace(/'/g, "''");
      expr = `${expr}${op}'${safeKey}'`;
    }
  }
  return `(${expr})`;
}

export function isJsonExtraction(col: string): boolean {
  return col.includes('->>');
}

export function mapJsToDbCol(tableName: string, mappings: FieldMapping[], jsField: string): string {
  if (jsField === '_id' || jsField === 'id') return 'id';

  // Direct match on top-level mapping
  const directMatch = mappings.find((item) => item.jsField === jsField || item.dbColumn === jsField);
  if (directMatch) return directMatch.dbColumn;

  // Custom records table handling
  if (tableName === 'custom_records') {
    const cleanField = jsField.startsWith('data.') ? jsField.slice(5) : jsField;
    const topLevelFields = ['organizationId', 'moduleId', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt'];
    if (topLevelFields.includes(cleanField)) {
      return camelToSnake(cleanField);
    }
    const parts = cleanField.split('.');
    return buildJsonPathExpr('data', parts);
  }

  // Handle dotted keys in any table (e.g. trigger.event -> (trigger->>'event'))
  if (jsField.includes('.')) {
    const parts = jsField.split('.');
    const firstSegment = parts[0];
    const subPath = parts.slice(1);

    const jsonMapping = mappings.find(
      (m) => (m.jsField === firstSegment || m.dbColumn === firstSegment || m.dbColumn === camelToSnake(firstSegment)) && m.isJson
    );

    if (jsonMapping) {
      return buildJsonPathExpr(jsonMapping.dbColumn, subPath);
    }

    const nonJsonMapping = mappings.find(
      (m) => m.jsField === firstSegment || m.dbColumn === firstSegment || m.dbColumn === camelToSnake(firstSegment)
    );
    if (nonJsonMapping) {
      return nonJsonMapping.dbColumn;
    }

    return buildJsonPathExpr(camelToSnake(firstSegment), subPath);
  }

  return camelToSnake(jsField);
}


function mapJsToDbRow(tableName: string, mappings: FieldMapping[], jsObj: any): Record<string, any> {
  const dbRow: Record<string, any> = {};

  mappings.forEach((m) => {
    let val = jsObj[m.jsField];
    if (val === undefined && m.dbColumn === 'id') {
      val = jsObj._id || jsObj.id;
    }

    if (val !== undefined) {
      if (m.isJson) {
        dbRow[m.dbColumn] = typeof val === 'string' ? val : JSON.stringify(val);
      } else if (val instanceof Date) {
        dbRow[m.dbColumn] = val.toISOString();
      } else if (val && typeof val === 'object' && val.toString && !(val instanceof Date)) {
        dbRow[m.dbColumn] = val.toString();
      } else {
        dbRow[m.dbColumn] = val;
      }
    }
  });

  if (!dbRow.id && (jsObj._id || jsObj.id)) {
    dbRow.id = String(jsObj._id || jsObj.id);
  }

  return dbRow;
}

function mapDbToJs(tableName: string, mappings: FieldMapping[], dbRow: any): any {
  if (!dbRow) return null;

  const jsObj: any = {};
  mappings.forEach((m) => {
    let val = dbRow[m.dbColumn];
    if (m.isJson && typeof val === 'string') {
      try {
        val = JSON.parse(val);
      } catch (e) {
        // Keep original string if parse fails
      }
    }
    jsObj[m.jsField] = val;
  });

  if (dbRow.id) {
    jsObj._id = String(dbRow.id);
    jsObj.id = String(dbRow.id);
  }

  Object.defineProperty(jsObj, 'save', {
    value: async function () {
      const dbObj = mapJsToDbRow(tableName, mappings, this);
      delete dbObj.id;
      dbObj.updated_at = new Date().toISOString();
      const setClauses: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;
      Object.keys(dbObj).forEach((col) => {
        setClauses.push(`${col} = $${paramIdx}`);
        params.push(dbObj[col]);
        paramIdx++;
      });
      params.push(this._id || this.id);
      const sql = `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`;
      await queryPg(sql, params);
      return this;
    },
    enumerable: false,
    writable: true
  });

  Object.defineProperty(jsObj, 'toObject', {
    value: function () { return { ...this }; },
    enumerable: false,
    writable: true
  });

  Object.defineProperty(jsObj, 'toJSON', {
    value: function () { return { ...this }; },
    enumerable: false,
    writable: true
  });

  return jsObj;
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function buildWhereClause(
  tableName: string, 
  mappings: FieldMapping[], 
  query: any, 
  params: any[] = []
): { whereClause: string; params: any[] } {
  if (!query || Object.keys(query).length === 0) {
    return { whereClause: '', params };
  }

  const conditions: string[] = [];

  const processCondition = (key: string, val: any) => {
    if (key === '$or' && Array.isArray(val)) {
      const orParts: string[] = [];
      val.forEach((subQ) => {
        const subResult = buildWhereClause(tableName, mappings, subQ, params);
        if (subResult.whereClause) {
          const subStr = subResult.whereClause.replace(/^WHERE\s+/, '');
          if (subStr) orParts.push(`(${subStr})`);
        }
      });
      if (orParts.length > 0) {
        conditions.push(`(${orParts.join(' OR ')})`);
      }
      return;
    }

    if (key === '$and' && Array.isArray(val)) {
      val.forEach((subQ) => {
        const subResult = buildWhereClause(tableName, mappings, subQ, params);
        if (subResult.whereClause) {
          const subStr = subResult.whereClause.replace(/^WHERE\s+/, '');
          if (subStr) conditions.push(`(${subStr})`);
        }
      });
      return;
    }

    const col = mapJsToDbCol(tableName, mappings, key);
    const isJson = isJsonExtraction(col);

    const numExpr = isJson ? `(CASE WHEN ${col} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${col})::numeric ELSE NULL END)` : col;
    const boolExpr = isJson ? `(CASE WHEN ${col} IN ('true', 't', '1', 'false', 'f', '0') THEN (${col})::boolean ELSE NULL END)` : col;
    const dateExpr = isJson ? `(CASE WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN (${col})::timestamptz ELSE NULL END)` : col;

    if (val === null || val === undefined) {
      conditions.push(`${col} IS NULL`);
      return;
    }

    if (typeof val === 'object' && !(val instanceof Date) && !(val instanceof PgObjectId)) {
      if (val.$in && Array.isArray(val.$in)) {
        if (val.$in.length === 0) {
          conditions.push(`1=0`);
        } else {
          const hasRegex = val.$in.some((item: any) => 
            item instanceof RegExp || 
            (typeof item === 'string' && item.startsWith('/') && item.lastIndexOf('/') > 0)
          );
          if (hasRegex) {
            const patterns = val.$in.map((item: any) => {
              if (item instanceof RegExp) return item.source;
              if (typeof item === 'string' && item.startsWith('/') && item.lastIndexOf('/') > 0) {
                return item.substring(1, item.lastIndexOf('/'));
              }
              const str = String(item._id || item);
              return `^\\s*${str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`;
            });
            const combined = `(${patterns.join('|')})`;
            params.push(combined);
            conditions.push(`${col} ~* $${params.length}`);
          } else {
            const allNumbers = val.$in.length > 0 && val.$in.every((item: any) => typeof item === 'number' && !isNaN(item));
            const allBooleans = val.$in.length > 0 && val.$in.every((item: any) => typeof item === 'boolean');

            if (isJson && allNumbers) {
              const inPlaceholders = val.$in.map((item: any) => {
                params.push(Number(item));
                return `$${params.length}`;
              }).join(', ');
              conditions.push(`${numExpr} IN (${inPlaceholders})`);
            } else if (isJson && allBooleans) {
              const inPlaceholders = val.$in.map((item: any) => {
                params.push(Boolean(item));
                return `$${params.length}`;
              }).join(', ');
              conditions.push(`${boolExpr} IN (${inPlaceholders})`);
            } else {
              const inPlaceholders = val.$in.map((item: any) => {
                params.push(String(item._id || item));
                return `$${params.length}`;
              }).join(', ');
              conditions.push(`${col} IN (${inPlaceholders})`);
            }
          }
        }
      } else if (val.$nin && Array.isArray(val.$nin)) {
        if (val.$nin.length > 0) {
          const hasRegex = val.$nin.some((item: any) => 
            item instanceof RegExp || 
            (typeof item === 'string' && item.startsWith('/') && item.lastIndexOf('/') > 0)
          );
          if (hasRegex) {
            const patterns = val.$nin.map((item: any) => {
              if (item instanceof RegExp) return item.source;
              if (typeof item === 'string' && item.startsWith('/') && item.lastIndexOf('/') > 0) {
                return item.substring(1, item.lastIndexOf('/'));
              }
              const str = String(item._id || item);
              return `^\\s*${str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`;
            });
            const combined = `(${patterns.join('|')})`;
            params.push(combined);
            conditions.push(`(${col} !~* $${params.length} OR ${col} IS NULL)`);
          } else {
            const allNumbers = val.$nin.length > 0 && val.$nin.every((item: any) => typeof item === 'number' && !isNaN(item));
            const allBooleans = val.$nin.length > 0 && val.$nin.every((item: any) => typeof item === 'boolean');

            if (isJson && allNumbers) {
              const ninPlaceholders = val.$nin.map((item: any) => {
                params.push(Number(item));
                return `$${params.length}`;
              }).join(', ');
              conditions.push(`(${numExpr} NOT IN (${ninPlaceholders}) OR ${col} IS NULL)`);
            } else if (isJson && allBooleans) {
              const ninPlaceholders = val.$nin.map((item: any) => {
                params.push(Boolean(item));
                return `$${params.length}`;
              }).join(', ');
              conditions.push(`(${boolExpr} NOT IN (${ninPlaceholders}) OR ${col} IS NULL)`);
            } else {
              const ninPlaceholders = val.$nin.map((item: any) => {
                params.push(String(item._id || item));
                return `$${params.length}`;
              }).join(', ');
              conditions.push(`(${col} NOT IN (${ninPlaceholders}) OR ${col} IS NULL)`);
            }
          }
        }
      } else if (val.$gte !== undefined || val.$lte !== undefined || val.$gt !== undefined || val.$lt !== undefined || val.$ne !== undefined) {
        const ops: Array<'$gte' | '$lte' | '$gt' | '$lt' | '$ne'> = ['$gte', '$lte', '$gt', '$lt', '$ne'];
        ops.forEach((op) => {
          if (val[op] === undefined) return;
          const operand = val[op];
          const sqlOp = op === '$gte' ? '>=' : op === '$lte' ? '<=' : op === '$gt' ? '>' : op === '$lt' ? '<' : '!=';

          if (operand === null) {
            if (op === '$ne') {
              conditions.push(`${col} IS NOT NULL`);
            } else {
              conditions.push(`${col} IS NULL`);
            }
            return;
          }

          if (typeof operand === 'number') {
            params.push(Number(operand));
            if (op === '$ne') {
              conditions.push(`(${numExpr} != $${params.length} OR ${col} IS NULL)`);
            } else {
              conditions.push(`${numExpr} ${sqlOp} $${params.length}`);
            }
          } else if (typeof operand === 'boolean') {
            params.push(Boolean(operand));
            if (op === '$ne') {
              conditions.push(`(${boolExpr} != $${params.length} OR ${col} IS NULL)`);
            } else {
              conditions.push(`${boolExpr} ${sqlOp} $${params.length}`);
            }
          } else if (operand instanceof Date || (typeof operand === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(operand))) {
            params.push(operand instanceof Date ? operand.toISOString() : operand);
            if (op === '$ne') {
              conditions.push(`(${dateExpr} != $${params.length} OR ${col} IS NULL)`);
            } else {
              conditions.push(`${dateExpr} ${sqlOp} $${params.length}`);
            }
          } else {
            const cleanOpVal = operand && operand._id ? String(operand._id) : (operand && operand.toString ? operand.toString() : operand);
            params.push(cleanOpVal);
            if (op === '$ne') {
              conditions.push(`(${col} != $${params.length} OR ${col} IS NULL)`);
            } else {
              conditions.push(`${col} ${sqlOp} $${params.length}`);
            }
          }
        });
      } else if (val.$exists !== undefined) {
        if (val.$exists) {
          conditions.push(`${col} IS NOT NULL`);
        } else {
          conditions.push(`${col} IS NULL`);
        }
      } else if (val.$regex !== undefined) {
        let pattern = typeof val.$regex === 'string' ? val.$regex : (val.$regex.source || String(val.$regex));
        pattern = pattern.replace(/^\/\^?/, '^').replace(/\$?\/[a-z]*$/, '');
        params.push(pattern);
        conditions.push(`${col} ~* $${params.length}`);
      } else if (val instanceof RegExp) {
        params.push(val.source);
        conditions.push(`${col} ~* $${params.length}`);
      } else {
        const cleanVal = val && val._id ? String(val._id) : (val && val.toString ? val.toString() : val);
        params.push(cleanVal);
        conditions.push(`${col} = $${params.length}`);
      }
    } else if (typeof val === 'boolean') {
      params.push(Boolean(val));
      conditions.push(`${boolExpr} = $${params.length}`);
    } else if (typeof val === 'number') {
      params.push(Number(val));
      conditions.push(`${numExpr} = $${params.length}`);
    } else if (val instanceof Date) {
      params.push(val.toISOString());
      conditions.push(`${dateExpr} = $${params.length}`);
    } else if (typeof val === 'string' && val.startsWith('/') && val.lastIndexOf('/') > 0) {
      const lastSlash = val.lastIndexOf('/');
      const rawPattern = val.substring(1, lastSlash);
      const cleanPattern = rawPattern.replace(/^\^?\\s\*/, '').replace(/\\s\*\$?$/, '').trim();
      params.push(cleanPattern || rawPattern);
      conditions.push(`${col} ~* $${params.length}`);
    } else {
      const cleanVal = val && val._id ? String(val._id) : (val && val.toString ? val.toString() : val);
      params.push(cleanVal);
      conditions.push(`${col} = $${params.length}`);
    }
  };

  Object.keys(query).forEach((key) => {
    processCondition(key, query[key]);
  });

  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

function applyMongoUpdate(target: any, updateDoc: any): any {
  const result = { ...target };
  if (!updateDoc) return result;

  if (updateDoc.$set) {
    Object.keys(updateDoc.$set).forEach((k) => {
      setNestedProperty(result, k, updateDoc.$set[k]);
    });
  }

  if (updateDoc.$inc) {
    Object.keys(updateDoc.$inc).forEach((k) => {
      const cur = getNestedProperty(result, k) || 0;
      setNestedProperty(result, k, Number(cur) + Number(updateDoc.$inc[k]));
    });
  }

  if (updateDoc.$push) {
    Object.keys(updateDoc.$push).forEach((k) => {
      const arr = getNestedProperty(result, k) || [];
      if (Array.isArray(arr)) {
        arr.push(updateDoc.$push[k]);
        setNestedProperty(result, k, arr);
      }
    });
  }

  Object.keys(updateDoc).forEach((k) => {
    if (!k.startsWith('$')) {
      setNestedProperty(result, k, updateDoc[k]);
    }
  });

  return result;
}

function getNestedProperty(obj: any, path: string): any {
  const parts = path.split('.');
  let curr = obj;
  for (const p of parts) {
    if (!curr) return undefined;
    curr = curr[p];
  }
  return curr;
}

function setNestedProperty(obj: any, path: string, val: any): void {
  const parts = path.split('.');
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!curr[p] || typeof curr[p] !== 'object') {
      curr[p] = {};
    }
    curr = curr[p];
  }
  curr[parts[parts.length - 1]] = val;
}

async function executeMongoAggregate(tableName: string, mappings: FieldMapping[], pipeline: any[]): Promise<any[]> {
  let matchQuery: any = {};
  let groupStage: any = null;

  pipeline.forEach((stage) => {
    if (stage.$match) matchQuery = { ...matchQuery, ...stage.$match };
    if (stage.$group) groupStage = stage.$group;
  });

  if (!groupStage) {
    return new PgQueryChain(tableName, mappings, matchQuery).exec();
  }

  const { whereClause, params } = buildWhereClause(tableName, mappings, matchQuery);
  const groupKey = groupStage._id;
  const groupCol = groupKey ? mapJsToDbCol(tableName, mappings, String(groupKey).replace(/^\$/, '')) : null;

  let groupSql = '';
  if (groupCol) {
    groupSql = `SELECT ${groupCol} as _id, COUNT(*)::int as count FROM ${tableName} ${whereClause} GROUP BY ${groupCol}`;
  } else {
    groupSql = `SELECT COUNT(*)::int as count FROM ${tableName} ${whereClause}`;
  }

  const rows = await queryPg(groupSql, params);
  return rows;
}
