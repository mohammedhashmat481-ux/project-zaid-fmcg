"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PgModel = exports.PgQueryChain = exports.createObjectId = exports.PgObjectId = void 0;
exports.createPgModel = createPgModel;
exports.buildJsonPathExpr = buildJsonPathExpr;
exports.isJsonExtraction = isJsonExtraction;
exports.mapJsToDbCol = mapJsToDbCol;
const postgres_1 = require("../config/postgres");
class PgObjectId {
    idStr;
    constructor(id) {
        if (id instanceof PgObjectId) {
            this.idStr = id.idStr;
        }
        else if (typeof id === 'string' && id.trim()) {
            this.idStr = id.trim();
        }
        else if (id && typeof id === 'object' && (id._id || id.id)) {
            this.idStr = String(id._id || id.id);
        }
        else {
            const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
            const randomHex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
            this.idStr = (timestamp + randomHex).toLowerCase();
        }
    }
    toString() { return this.idStr; }
    toHexString() { return this.idStr; }
    toJSON() { return this.idStr; }
    equals(other) {
        if (!other)
            return false;
        return String(this.idStr) === String(other);
    }
    static isValid(id) {
        if (!id)
            return false;
        const s = String(id).trim();
        return /^[0-9a-fA-F]{24}$/.test(s) || /^[0-9a-fA-F-]{36}$/.test(s);
    }
}
exports.PgObjectId = PgObjectId;
const createObjectId = (id) => new PgObjectId(id);
exports.createObjectId = createObjectId;
class PgQueryChain {
    tableName;
    mappings;
    queryObj;
    sortObj = null;
    skipVal = 0;
    limitVal = null;
    isSingle = false;
    selectFields = null;
    populateList = [];
    constructor(tableName, mappings, queryObj = {}, isSingle = false) {
        this.tableName = tableName;
        this.mappings = mappings;
        this.queryObj = queryObj || {};
        this.isSingle = isSingle;
        if (isSingle) {
            this.limitVal = 1;
        }
    }
    sort(sortArg) {
        this.sortObj = sortArg;
        return this;
    }
    skip(skipArg) {
        this.skipVal = Number(skipArg) || 0;
        return this;
    }
    limit(limitArg) {
        this.limitVal = Number(limitArg);
        return this;
    }
    select(fields) {
        if (typeof fields === 'string') {
            this.selectFields = fields.trim().split(/\s+/).filter(Boolean);
        }
        else if (Array.isArray(fields)) {
            this.selectFields = fields.filter(Boolean);
        }
        return this;
    }
    populate(arg, selectFields) {
        if (!arg)
            return this;
        if (typeof arg === 'string') {
            this.populateList.push({ path: arg, select: typeof selectFields === 'string' ? selectFields : undefined });
        }
        else if (typeof arg === 'object') {
            if (Array.isArray(arg)) {
                arg.forEach((item) => {
                    if (typeof item === 'string')
                        this.populateList.push({ path: item });
                    else if (item && item.path)
                        this.populateList.push({ path: item.path, select: item.select });
                });
            }
            else if (arg.path) {
                this.populateList.push({ path: arg.path, select: arg.select });
            }
        }
        return this;
    }
    lean(arg) {
        return this;
    }
    async exec() {
        let res = await this.executeFind();
        if (this.populateList.length > 0 && res.length > 0) {
            res = await this.executePopulates(res);
        }
        return this.isSingle ? (res.length > 0 ? res[0] : null) : res;
    }
    async executePopulates(docs) {
        for (const pop of this.populateList) {
            const path = pop.path;
            try {
                if (path === 'roleId' || path === 'role') {
                    const ids = [...new Set(docs.map((d) => {
                            const v = d.roleId || d.role;
                            return typeof v === 'object' ? (v?._id || v?.id) : v;
                        }).filter(Boolean))];
                    if (ids.length > 0) {
                        const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
                        const rows = await (0, postgres_1.queryPg)(`SELECT id, name, is_system, permissions FROM roles WHERE id IN (${placeholders})`, ids);
                        const map = new Map();
                        rows.forEach((r) => {
                            map.set(r.id, {
                                _id: r.id,
                                id: r.id,
                                name: r.name,
                                isSystem: r.is_system,
                                permissions: r.permissions
                            });
                        });
                        docs.forEach((d) => {
                            const rawId = typeof d.roleId === 'object' ? (d.roleId?._id || d.roleId?.id) : d.roleId;
                            if (rawId && map.has(rawId)) {
                                d.roleId = map.get(rawId);
                                d.role = map.get(rawId);
                            }
                        });
                    }
                }
                else if (path === 'reportingManager') {
                    const ids = [...new Set(docs.map((d) => {
                            const v = d.reportingManager;
                            return typeof v === 'object' ? (v?._id || v?.id) : v;
                        }).filter(Boolean))];
                    if (ids.length > 0) {
                        const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
                        const rows = await (0, postgres_1.queryPg)(`SELECT id, first_name, last_name, email, department FROM users WHERE id IN (${placeholders})`, ids);
                        const map = new Map();
                        rows.forEach((r) => {
                            map.set(r.id, {
                                _id: r.id,
                                id: r.id,
                                firstName: r.first_name,
                                lastName: r.last_name,
                                email: r.email,
                                department: r.department
                            });
                        });
                        docs.forEach((d) => {
                            const rawId = typeof d.reportingManager === 'object' ? (d.reportingManager?._id || d.reportingManager?.id) : d.reportingManager;
                            if (rawId && map.has(rawId)) {
                                d.reportingManager = map.get(rawId);
                            }
                        });
                    }
                }
                else if (path === 'moduleId') {
                    const ids = [...new Set(docs.map((d) => {
                            const v = d.moduleId;
                            return typeof v === 'object' ? (v?._id || v?.id) : v;
                        }).filter(Boolean))];
                    if (ids.length > 0) {
                        const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
                        const rows = await (0, postgres_1.queryPg)(`SELECT id, name, singular_label, plural_label, api_path, icon FROM module_definitions WHERE id IN (${placeholders})`, ids);
                        const map = new Map();
                        rows.forEach((r) => {
                            map.set(r.id, {
                                _id: r.id,
                                id: r.id,
                                name: r.name,
                                singularLabel: r.singular_label,
                                pluralLabel: r.plural_label,
                                apiPath: r.api_path,
                                icon: r.icon
                            });
                        });
                        docs.forEach((d) => {
                            const rawId = typeof d.moduleId === 'object' ? (d.moduleId?._id || d.moduleId?.id) : d.moduleId;
                            if (rawId && map.has(rawId)) {
                                d.moduleId = map.get(rawId);
                            }
                        });
                    }
                }
                else if (path === 'createdBy' || path === 'updatedBy' || path === 'userId') {
                    const ids = [...new Set(docs.map((d) => {
                            const v = d[path];
                            return typeof v === 'object' ? (v?._id || v?.id) : v;
                        }).filter(Boolean))];
                    if (ids.length > 0) {
                        const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
                        const rows = await (0, postgres_1.queryPg)(`SELECT id, first_name, last_name, email FROM users WHERE id IN (${placeholders})`, ids);
                        const map = new Map();
                        rows.forEach((r) => {
                            map.set(r.id, {
                                _id: r.id,
                                id: r.id,
                                firstName: r.first_name,
                                lastName: r.last_name,
                                email: r.email
                            });
                        });
                        docs.forEach((d) => {
                            const rawId = typeof d[path] === 'object' ? (d[path]?._id || d[path]?.id) : d[path];
                            if (rawId && map.has(rawId)) {
                                d[path] = map.get(rawId);
                            }
                        });
                    }
                }
            }
            catch (popErr) {
                console.warn(`[PgQueryChain] Failed to populate path '${path}':`, popErr);
            }
        }
        return docs;
    }
    then(onfulfilled, onrejected) {
        return this.exec().then(onfulfilled, onrejected);
    }
    async executeFind() {
        const { whereClause, params } = buildWhereClause(this.tableName, this.mappings, this.queryObj);
        let sql = `SELECT * FROM ${this.tableName} ${whereClause}`;
        if (this.sortObj) {
            const orderParts = [];
            if (typeof this.sortObj === 'string') {
                const desc = this.sortObj.startsWith('-');
                const fieldName = desc ? this.sortObj.substring(1) : this.sortObj;
                const col = mapJsToDbCol(this.tableName, this.mappings, fieldName);
                orderParts.push(`${col} ${desc ? 'DESC' : 'ASC'}`);
            }
            else if (typeof this.sortObj === 'object') {
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
        const rows = await (0, postgres_1.queryPg)(sql, params);
        const docs = rows.map((r) => mapDbToJs(this.tableName, this.mappings, r));
        if (this.selectFields && this.selectFields.length > 0) {
            return docs.map((d) => applyProjection(d, this.selectFields));
        }
        return docs;
    }
}
exports.PgQueryChain = PgQueryChain;
function applyProjection(doc, selectFields) {
    if (!doc || !selectFields || selectFields.length === 0)
        return doc;
    const inclusions = selectFields.filter((f) => !f.startsWith('-'));
    const exclusions = selectFields.filter((f) => f.startsWith('-')).map((f) => f.slice(1));
    if (exclusions.length > 0) {
        exclusions.forEach((field) => {
            if (field.startsWith('data.')) {
                const sub = field.slice(5);
                if (doc.data && typeof doc.data === 'object')
                    delete doc.data[sub];
            }
            else {
                delete doc[field];
            }
        });
    }
    if (inclusions.length > 0) {
        const projected = {};
        if (inclusions.includes('_id') || !inclusions.some((f) => f === '-_id')) {
            projected._id = doc._id;
            projected.id = doc.id;
        }
        const dataInclusions = inclusions.filter((f) => f.startsWith('data.')).map((f) => f.slice(5));
        if (dataInclusions.length > 0 && doc.data && typeof doc.data === 'object') {
            projected.data = {};
            dataInclusions.forEach((k) => {
                if (doc.data[k] !== undefined) {
                    projected.data[k] = doc.data[k];
                }
            });
        }
        else if (inclusions.includes('data') && doc.data) {
            projected.data = doc.data;
        }
        inclusions.forEach((f) => {
            if (!f.startsWith('data.') && doc[f] !== undefined) {
                projected[f] = doc[f];
            }
        });
        return projected;
    }
    return doc;
}
class PgModel {
    tableName;
    mappings;
    dataData;
    constructor(tableName, mappings, initialData) {
        this.tableName = tableName;
        this.mappings = mappings;
        this.dataData = initialData;
        if (initialData && typeof initialData === 'object') {
            Object.assign(this, initialData);
            if (!this._id) {
                this._id = new PgObjectId().toString();
            }
        }
    }
    async save() {
        const doc = { ...this };
        delete doc.tableName;
        delete doc.mappings;
        delete doc.dataData;
        const existing = await this.findById(doc._id);
        if (existing) {
            await this.updateOne({ _id: doc._id }, doc);
            return this.findById(doc._id);
        }
        else {
            return this.create(doc);
        }
    }
    find(query = {}) {
        return new PgQueryChain(this.tableName, this.mappings, query, false);
    }
    findOne(query = {}) {
        return new PgQueryChain(this.tableName, this.mappings, query, true);
    }
    findById(id) {
        if (!id)
            return new PgQueryChain(this.tableName, this.mappings, { _id: '__none__' }, true);
        const cleanId = String(id._id || id).trim();
        return new PgQueryChain(this.tableName, this.mappings, { _id: cleanId }, true);
    }
    async create(data, options) {
        if (Array.isArray(data)) {
            return this.insertMany(data);
        }
        const doc = { ...data };
        if (!doc._id && !doc.id) {
            doc._id = new PgObjectId().toString();
        }
        else {
            doc._id = String(doc._id || doc.id);
        }
        if (!doc.createdAt)
            doc.createdAt = new Date();
        if (!doc.updatedAt)
            doc.updatedAt = new Date();
        const dbObj = mapJsToDbRow(this.tableName, this.mappings, doc);
        const cols = Object.keys(dbObj);
        const vals = Object.values(dbObj);
        const paramPlaceholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const colNames = cols.join(', ');
        const sql = `INSERT INTO ${this.tableName} (${colNames}) VALUES (${paramPlaceholders}) RETURNING *`;
        const rows = await (0, postgres_1.queryPg)(sql, vals);
        return mapDbToJs(this.tableName, this.mappings, rows[0]);
    }
    async insertMany(docs) {
        if (!Array.isArray(docs) || docs.length === 0)
            return [];
        const results = [];
        for (const d of docs) {
            const created = await this.create(d);
            results.push(created);
        }
        return results;
    }
    async updateOne(query, updateDoc) {
        const target = await this.findOne(query);
        if (!target)
            return { modifiedCount: 0 };
        const updatedData = applyMongoUpdate(target, updateDoc);
        updatedData.updatedAt = new Date();
        const dbObj = mapJsToDbRow(this.tableName, this.mappings, updatedData);
        delete dbObj.id; // Primary key immutable
        const setClauses = [];
        const params = [];
        let paramIdx = 1;
        Object.keys(dbObj).forEach((col) => {
            setClauses.push(`${col} = $${paramIdx}`);
            params.push(dbObj[col]);
            paramIdx++;
        });
        params.push(target._id);
        const sql = `UPDATE ${this.tableName} SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`;
        await (0, postgres_1.queryPg)(sql, params);
        return { modifiedCount: 1 };
    }
    async updateMany(query, updateDoc) {
        const targets = await this.find(query).exec();
        let modifiedCount = 0;
        for (const t of targets) {
            const res = await this.updateOne({ _id: t._id }, updateDoc);
            modifiedCount += res.modifiedCount;
        }
        return { modifiedCount };
    }
    async findByIdAndUpdate(id, updateDoc, options = { new: true }) {
        if (!id)
            return null;
        const cleanId = String(id._id || id).trim();
        await this.updateOne({ _id: cleanId }, updateDoc);
        return this.findById(cleanId);
    }
    async findOneAndUpdate(query, updateDoc, options = { new: true }) {
        const target = await this.findOne(query);
        if (!target)
            return null;
        await this.updateOne({ _id: target._id }, updateDoc);
        return this.findById(target._id);
    }
    async deleteOne(query) {
        const target = await this.findOne(query);
        if (!target)
            return { deletedCount: 0 };
        const sql = `DELETE FROM ${this.tableName} WHERE id = $1`;
        await (0, postgres_1.queryPg)(sql, [target._id]);
        return { deletedCount: 1 };
    }
    async deleteMany(query) {
        const { whereClause, params } = buildWhereClause(this.tableName, this.mappings, query);
        const countSql = `SELECT COUNT(*)::int as count FROM ${this.tableName} ${whereClause}`;
        const countRes = await (0, postgres_1.queryPg)(countSql, params);
        const count = countRes[0]?.count || 0;
        const deleteSql = `DELETE FROM ${this.tableName} ${whereClause}`;
        await (0, postgres_1.queryPg)(deleteSql, params);
        return { deletedCount: count };
    }
    async findByIdAndDelete(id) {
        if (!id)
            return null;
        const cleanId = String(id._id || id).trim();
        const existing = await this.findById(cleanId);
        if (!existing)
            return null;
        await this.deleteOne({ _id: cleanId });
        return existing;
    }
    async findOneAndDelete(query) {
        const existing = await this.findOne(query);
        if (!existing)
            return null;
        await this.deleteOne({ _id: existing._id });
        return existing;
    }
    async countDocuments(query = {}) {
        const { whereClause, params } = buildWhereClause(this.tableName, this.mappings, query);
        const sql = `SELECT COUNT(*)::int as count FROM ${this.tableName} ${whereClause}`;
        const rows = await (0, postgres_1.queryPg)(sql, params);
        return rows[0]?.count || 0;
    }
    async aggregate(pipeline) {
        return executeMongoAggregate(this.tableName, this.mappings, pipeline);
    }
}
exports.PgModel = PgModel;
// Helper factory for model instantiation
function createPgModel(tableName, mappings) {
    const modelConstructor = function (initialData) {
        return new PgModel(tableName, mappings, initialData);
    };
    Object.setPrototypeOf(modelConstructor, new PgModel(tableName, mappings));
    return modelConstructor;
}
function buildJsonPathExpr(col, pathParts) {
    const safeCol = col.replace(/[^a-zA-Z0-9_]/g, '');
    if (!pathParts || pathParts.length === 0)
        return safeCol;
    let expr = safeCol;
    for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        const isLast = (i === pathParts.length - 1);
        const isIndex = /^\d+$/.test(part);
        const op = isLast ? '->>' : '->';
        if (isIndex) {
            expr = `${expr}${op}${part}`;
        }
        else {
            const safeKey = part.replace(/'/g, "''");
            expr = `${expr}${op}'${safeKey}'`;
        }
    }
    return `(${expr})`;
}
function isJsonExtraction(col) {
    return col.includes('->>');
}
function mapJsToDbCol(tableName, mappings, jsField) {
    if (jsField === '_id' || jsField === 'id')
        return 'id';
    // Direct match on top-level mapping
    const directMatch = mappings.find((item) => item.jsField === jsField || item.dbColumn === jsField);
    if (directMatch)
        return directMatch.dbColumn;
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
        const jsonMapping = mappings.find((m) => (m.jsField === firstSegment || m.dbColumn === firstSegment || m.dbColumn === camelToSnake(firstSegment)) && m.isJson);
        if (jsonMapping) {
            return buildJsonPathExpr(jsonMapping.dbColumn, subPath);
        }
        const nonJsonMapping = mappings.find((m) => m.jsField === firstSegment || m.dbColumn === firstSegment || m.dbColumn === camelToSnake(firstSegment));
        if (nonJsonMapping) {
            return nonJsonMapping.dbColumn;
        }
        return buildJsonPathExpr(camelToSnake(firstSegment), subPath);
    }
    return camelToSnake(jsField);
}
function mapJsToDbRow(tableName, mappings, jsObj) {
    const dbRow = {};
    mappings.forEach((m) => {
        let val = jsObj[m.jsField];
        if (val === undefined && m.dbColumn === 'id') {
            val = jsObj._id || jsObj.id;
        }
        if (val !== undefined) {
            if (m.isJson) {
                dbRow[m.dbColumn] = typeof val === 'string' ? val : JSON.stringify(val);
            }
            else if (val instanceof Date) {
                dbRow[m.dbColumn] = val.toISOString();
            }
            else if (val && typeof val === 'object' && val.toString && !(val instanceof Date)) {
                dbRow[m.dbColumn] = val.toString();
            }
            else {
                dbRow[m.dbColumn] = val;
            }
        }
    });
    if (!dbRow.id && (jsObj._id || jsObj.id)) {
        dbRow.id = String(jsObj._id || jsObj.id);
    }
    return dbRow;
}
function mapDbToJs(tableName, mappings, dbRow) {
    if (!dbRow)
        return null;
    const jsObj = {};
    mappings.forEach((m) => {
        let val = dbRow[m.dbColumn];
        if (m.isJson && typeof val === 'string') {
            try {
                val = JSON.parse(val);
            }
            catch (e) {
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
            const setClauses = [];
            const params = [];
            let paramIdx = 1;
            Object.keys(dbObj).forEach((col) => {
                setClauses.push(`${col} = $${paramIdx}`);
                params.push(dbObj[col]);
                paramIdx++;
            });
            params.push(this._id || this.id);
            const sql = `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`;
            await (0, postgres_1.queryPg)(sql, params);
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
function camelToSnake(str) {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
function buildWhereClause(tableName, mappings, query, params = []) {
    if (!query || Object.keys(query).length === 0) {
        return { whereClause: '', params };
    }
    const conditions = [];
    const processCondition = (key, val) => {
        if (key === '$or' && Array.isArray(val)) {
            const orParts = [];
            val.forEach((subQ) => {
                const subResult = buildWhereClause(tableName, mappings, subQ, params);
                if (subResult.whereClause) {
                    const subStr = subResult.whereClause.replace(/^WHERE\s+/, '');
                    if (subStr)
                        orParts.push(`(${subStr})`);
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
                    if (subStr)
                        conditions.push(`(${subStr})`);
                }
            });
            return;
        }
        if (key === '$nor' && Array.isArray(val)) {
            const orParts = [];
            val.forEach((subQ) => {
                const subResult = buildWhereClause(tableName, mappings, subQ, params);
                if (subResult.whereClause) {
                    const subStr = subResult.whereClause.replace(/^WHERE\s+/, '');
                    if (subStr)
                        orParts.push(`(${subStr})`);
                }
            });
            if (orParts.length > 0) {
                conditions.push(`NOT (${orParts.join(' OR ')})`);
            }
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
                }
                else {
                    const hasRegex = val.$in.some((item) => item instanceof RegExp ||
                        (typeof item === 'string' && item.startsWith('/') && item.lastIndexOf('/') > 0));
                    if (hasRegex) {
                        const patterns = val.$in.map((item) => {
                            if (item instanceof RegExp)
                                return item.source;
                            if (typeof item === 'string' && item.startsWith('/') && item.lastIndexOf('/') > 0) {
                                return item.substring(1, item.lastIndexOf('/'));
                            }
                            const str = String(item._id || item);
                            return `^\\s*${str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`;
                        });
                        const combined = `(${patterns.join('|')})`;
                        params.push(combined);
                        conditions.push(`${col} ~* $${params.length}`);
                    }
                    else {
                        const allNumbers = val.$in.length > 0 && val.$in.every((item) => typeof item === 'number' && !isNaN(item));
                        const allBooleans = val.$in.length > 0 && val.$in.every((item) => typeof item === 'boolean');
                        if (isJson && allNumbers) {
                            const inPlaceholders = val.$in.map((item) => {
                                params.push(Number(item));
                                return `$${params.length}`;
                            }).join(', ');
                            conditions.push(`${numExpr} IN (${inPlaceholders})`);
                        }
                        else if (isJson && allBooleans) {
                            const inPlaceholders = val.$in.map((item) => {
                                params.push(Boolean(item));
                                return `$${params.length}`;
                            }).join(', ');
                            conditions.push(`${boolExpr} IN (${inPlaceholders})`);
                        }
                        else {
                            const hasNull = val.$in.some((item) => item === null || item === undefined);
                            const nonNullItems = val.$in.filter((item) => item !== null && item !== undefined);
                            if (nonNullItems.length > 0) {
                                const inPlaceholders = nonNullItems.map((item) => {
                                    params.push(String(item._id || item));
                                    return `$${params.length}`;
                                }).join(', ');
                                if (hasNull) {
                                    conditions.push(`(${col} IN (${inPlaceholders}) OR ${col} IS NULL)`);
                                }
                                else {
                                    conditions.push(`${col} IN (${inPlaceholders})`);
                                }
                            }
                            else if (hasNull) {
                                conditions.push(`${col} IS NULL`);
                            }
                        }
                    }
                }
            }
            else if (val.$nin && Array.isArray(val.$nin)) {
                if (val.$nin.length > 0) {
                    const hasRegex = val.$nin.some((item) => item instanceof RegExp ||
                        (typeof item === 'string' && item.startsWith('/') && item.lastIndexOf('/') > 0));
                    if (hasRegex) {
                        const patterns = val.$nin.map((item) => {
                            if (item instanceof RegExp)
                                return item.source;
                            if (typeof item === 'string' && item.startsWith('/') && item.lastIndexOf('/') > 0) {
                                return item.substring(1, item.lastIndexOf('/'));
                            }
                            const str = item !== null && item !== undefined ? String(item._id || item) : '';
                            return `^\\s*${str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`;
                        });
                        const combined = `(${patterns.join('|')})`;
                        params.push(combined);
                        conditions.push(`(${col} !~* $${params.length} OR ${col} IS NULL)`);
                    }
                    else {
                        const allNumbers = val.$nin.length > 0 && val.$nin.every((item) => typeof item === 'number' && !isNaN(item));
                        const allBooleans = val.$nin.length > 0 && val.$nin.every((item) => typeof item === 'boolean');
                        if (isJson && allNumbers) {
                            const ninPlaceholders = val.$nin.map((item) => {
                                params.push(Number(item));
                                return `$${params.length}`;
                            }).join(', ');
                            conditions.push(`(${numExpr} NOT IN (${ninPlaceholders}) OR ${col} IS NULL)`);
                        }
                        else if (isJson && allBooleans) {
                            const ninPlaceholders = val.$nin.map((item) => {
                                params.push(Boolean(item));
                                return `$${params.length}`;
                            }).join(', ');
                            conditions.push(`(${boolExpr} NOT IN (${ninPlaceholders}) OR ${col} IS NULL)`);
                        }
                        else {
                            const hasNull = val.$nin.some((item) => item === null || item === undefined);
                            const nonNullItems = val.$nin.filter((item) => item !== null && item !== undefined);
                            if (nonNullItems.length > 0) {
                                const ninPlaceholders = nonNullItems.map((item) => {
                                    params.push(String(item._id || item));
                                    return `$${params.length}`;
                                }).join(', ');
                                if (hasNull) {
                                    conditions.push(`(${col} NOT IN (${ninPlaceholders}) AND ${col} IS NOT NULL)`);
                                }
                                else {
                                    conditions.push(`(${col} NOT IN (${ninPlaceholders}) OR ${col} IS NULL)`);
                                }
                            }
                            else if (hasNull) {
                                conditions.push(`${col} IS NOT NULL`);
                            }
                        }
                    }
                }
            }
            else if (val.$gte !== undefined || val.$lte !== undefined || val.$gt !== undefined || val.$lt !== undefined || val.$ne !== undefined) {
                const ops = ['$gte', '$lte', '$gt', '$lt', '$ne'];
                ops.forEach((op) => {
                    if (val[op] === undefined)
                        return;
                    const operand = val[op];
                    const sqlOp = op === '$gte' ? '>=' : op === '$lte' ? '<=' : op === '$gt' ? '>' : op === '$lt' ? '<' : '!=';
                    if (operand === null) {
                        if (op === '$ne') {
                            conditions.push(`${col} IS NOT NULL`);
                        }
                        else {
                            conditions.push(`${col} IS NULL`);
                        }
                        return;
                    }
                    if (typeof operand === 'number') {
                        params.push(Number(operand));
                        if (op === '$ne') {
                            conditions.push(`(${numExpr} != $${params.length} OR ${col} IS NULL)`);
                        }
                        else {
                            conditions.push(`${numExpr} ${sqlOp} $${params.length}`);
                        }
                    }
                    else if (typeof operand === 'boolean') {
                        params.push(Boolean(operand));
                        if (op === '$ne') {
                            conditions.push(`(${boolExpr} != $${params.length} OR ${col} IS NULL)`);
                        }
                        else {
                            conditions.push(`${boolExpr} ${sqlOp} $${params.length}`);
                        }
                    }
                    else if (operand instanceof Date || (typeof operand === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(operand))) {
                        params.push(operand instanceof Date ? operand.toISOString() : operand);
                        if (op === '$ne') {
                            conditions.push(`(${dateExpr} != $${params.length} OR ${col} IS NULL)`);
                        }
                        else {
                            conditions.push(`${dateExpr} ${sqlOp} $${params.length}`);
                        }
                    }
                    else {
                        const cleanOpVal = operand && operand._id ? String(operand._id) : (operand && operand.toString ? operand.toString() : operand);
                        params.push(cleanOpVal);
                        if (op === '$ne') {
                            conditions.push(`(${col} != $${params.length} OR ${col} IS NULL)`);
                        }
                        else {
                            conditions.push(`${col} ${sqlOp} $${params.length}`);
                        }
                    }
                });
            }
            else if (val.$exists !== undefined) {
                if (val.$exists) {
                    conditions.push(`${col} IS NOT NULL`);
                }
                else {
                    conditions.push(`${col} IS NULL`);
                }
            }
            else if (val.$regex !== undefined) {
                let pattern = typeof val.$regex === 'string' ? val.$regex : (val.$regex.source || String(val.$regex));
                pattern = pattern.replace(/^\/\^?/, '^').replace(/\$?\/[a-z]*$/, '');
                params.push(pattern);
                conditions.push(`${col} ~* $${params.length}`);
            }
            else if (val instanceof RegExp) {
                params.push(val.source);
                conditions.push(`${col} ~* $${params.length}`);
            }
            else {
                const cleanVal = val && val._id ? String(val._id) : (val && val.toString ? val.toString() : val);
                params.push(cleanVal);
                conditions.push(`${col} = $${params.length}`);
            }
        }
        else if (typeof val === 'boolean') {
            params.push(Boolean(val));
            conditions.push(`${boolExpr} = $${params.length}`);
        }
        else if (typeof val === 'number') {
            params.push(Number(val));
            conditions.push(`${numExpr} = $${params.length}`);
        }
        else if (val instanceof Date) {
            params.push(val.toISOString());
            conditions.push(`${dateExpr} = $${params.length}`);
        }
        else if (typeof val === 'string' && val.startsWith('/') && val.lastIndexOf('/') > 0) {
            const lastSlash = val.lastIndexOf('/');
            const rawPattern = val.substring(1, lastSlash);
            const cleanPattern = rawPattern.replace(/^\^?\\s\*/, '').replace(/\\s\*\$?$/, '').trim();
            params.push(cleanPattern || rawPattern);
            conditions.push(`${col} ~* $${params.length}`);
        }
        else {
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
function applyMongoUpdate(target, updateDoc) {
    const result = { ...target };
    if (!updateDoc)
        return result;
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
function getNestedProperty(obj, path) {
    const parts = path.split('.');
    let curr = obj;
    for (const p of parts) {
        if (!curr)
            return undefined;
        curr = curr[p];
    }
    return curr;
}
function setNestedProperty(obj, path, val) {
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
function extractFieldFromAccum(expr) {
    if (!expr)
        return null;
    if (typeof expr === 'string') {
        return expr.startsWith('$') ? expr.slice(1) : expr;
    }
    if (typeof expr === 'object') {
        if (expr.$toDouble && typeof expr.$toDouble === 'string') {
            return expr.$toDouble.startsWith('$') ? expr.$toDouble.slice(1) : expr.$toDouble;
        }
        if (expr.$toInt && typeof expr.$toInt === 'string') {
            return expr.$toInt.startsWith('$') ? expr.$toInt.slice(1) : expr.$toInt;
        }
        if (expr.$cond) {
            if (typeof expr.$cond.then === 'string')
                return expr.$cond.then.startsWith('$') ? expr.$cond.then.slice(1) : expr.$cond.then;
            if (typeof expr.$cond.else === 'string')
                return expr.$cond.else.startsWith('$') ? expr.$cond.else.slice(1) : expr.$cond.else;
            if (expr.$cond.else?.$convert?.input) {
                const inp = String(expr.$cond.else.$convert.input);
                return inp.startsWith('$') ? inp.slice(1) : inp;
            }
        }
        for (const k of Object.keys(expr)) {
            const sub = extractFieldFromAccum(expr[k]);
            if (sub)
                return sub;
        }
    }
    return null;
}
async function executeMongoAggregate(tableName, mappings, pipeline) {
    let matchQuery = {};
    let groupStage = null;
    let sortStage = null;
    let limitStage = null;
    pipeline.forEach((stage) => {
        if (stage.$match)
            matchQuery = { ...matchQuery, ...stage.$match };
        if (stage.$group)
            groupStage = stage.$group;
        if (stage.$sort)
            sortStage = stage.$sort;
        if (typeof stage.$limit === 'number')
            limitStage = stage.$limit;
    });
    if (!groupStage) {
        let chain = new PgQueryChain(tableName, mappings, matchQuery);
        if (sortStage)
            chain = chain.sort(sortStage);
        if (limitStage)
            chain = chain.limit(limitStage);
        return chain.exec();
    }
    const { whereClause, params } = buildWhereClause(tableName, mappings, matchQuery);
    const groupKey = groupStage._id;
    const groupCol = groupKey ? mapJsToDbCol(tableName, mappings, String(groupKey).replace(/^\$/, '')) : null;
    const selectItems = [];
    const groupCols = [];
    let hasExplicitCount = false;
    let hasExplicitValue = false;
    if (groupCol) {
        selectItems.push(`${groupCol} as _id`);
        selectItems.push(`COALESCE(NULLIF(${groupCol}, ''), 'Unassigned') as label`);
        groupCols.push(groupCol);
    }
    // Process all accumulators in $group (excluding _id)
    Object.keys(groupStage).forEach((alias) => {
        if (alias === '_id')
            return;
        const acc = groupStage[alias];
        if (alias === 'count')
            hasExplicitCount = true;
        if (alias === 'value')
            hasExplicitValue = true;
        if (acc && typeof acc === 'object') {
            if (acc.$sum !== undefined) {
                if (acc.$sum === 1 || acc.$sum === '1') {
                    selectItems.push(`COUNT(*)::numeric as "${alias}"`);
                }
                else {
                    const field = extractFieldFromAccum(acc.$sum);
                    if (field) {
                        const col = mapJsToDbCol(tableName, mappings, field);
                        selectItems.push(`COALESCE(SUM(NULLIF(regexp_replace(${col}, '[^0-9.]', '', 'g'), '')::numeric), 0) as "${alias}"`);
                    }
                    else {
                        selectItems.push(`COUNT(*)::numeric as "${alias}"`);
                    }
                }
            }
            else if (acc.$avg !== undefined) {
                const field = extractFieldFromAccum(acc.$avg);
                if (field) {
                    const col = mapJsToDbCol(tableName, mappings, field);
                    selectItems.push(`COALESCE(AVG(NULLIF(regexp_replace(${col}, '[^0-9.]', '', 'g'), '')::numeric), 0) as "${alias}"`);
                }
                else {
                    selectItems.push(`0::numeric as "${alias}"`);
                }
            }
            else if (acc.$min !== undefined) {
                const field = extractFieldFromAccum(acc.$min);
                if (field) {
                    const col = mapJsToDbCol(tableName, mappings, field);
                    selectItems.push(`COALESCE(MIN(NULLIF(regexp_replace(${col}, '[^0-9.]', '', 'g'), '')::numeric), 0) as "${alias}"`);
                }
                else {
                    selectItems.push(`0::numeric as "${alias}"`);
                }
            }
            else if (acc.$max !== undefined) {
                const field = extractFieldFromAccum(acc.$max);
                if (field) {
                    const col = mapJsToDbCol(tableName, mappings, field);
                    selectItems.push(`COALESCE(MAX(NULLIF(regexp_replace(${col}, '[^0-9.]', '', 'g'), '')::numeric), 0) as "${alias}"`);
                }
                else {
                    selectItems.push(`0::numeric as "${alias}"`);
                }
            }
            else {
                selectItems.push(`COUNT(*)::numeric as "${alias}"`);
            }
        }
        else {
            selectItems.push(`COUNT(*)::numeric as "${alias}"`);
        }
    });
    if (!hasExplicitCount) {
        selectItems.push('COUNT(*)::int as count');
    }
    if (!hasExplicitValue) {
        selectItems.push('COUNT(*)::numeric as value');
    }
    let groupSql = `SELECT ${selectItems.join(', ')} FROM ${tableName} ${whereClause}`;
    if (groupCols.length > 0) {
        groupSql += ` GROUP BY ${groupCols.join(', ')}`;
    }
    if (sortStage) {
        const orderParts = [];
        if (typeof sortStage === 'object') {
            Object.keys(sortStage).forEach((k) => {
                const dir = Number(sortStage[k]) < 0 ? 'DESC' : 'ASC';
                if (k === 'label' || k === 'value' || k === 'count' || k === '_id' || groupStage[k]) {
                    orderParts.push(`"${k}" ${dir}`);
                }
                else if (groupCol) {
                    orderParts.push(`${groupCol} ${dir}`);
                }
            });
        }
        if (orderParts.length > 0) {
            groupSql += ` ORDER BY ${orderParts.join(', ')}`;
        }
    }
    if (limitStage && limitStage > 0) {
        groupSql += ` LIMIT ${limitStage}`;
    }
    const rows = await (0, postgres_1.queryPg)(groupSql, params);
    return rows.map((r) => {
        const item = { ...r };
        const rawId = item._id !== undefined && item._id !== null ? item._id : item.label;
        item._id = rawId !== undefined && rawId !== null ? String(rawId) : 'Unassigned';
        item.label = item.label || item._id || 'Unassigned';
        item.count = Number(item.count || item.value || 0);
        item.value = item.value !== undefined ? Number(item.value) : item.count;
        if (item.total !== undefined) {
            item.total = Number(item.total);
        }
        return item;
    });
}
