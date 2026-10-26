"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PgModel_1 = require("./PgModel");
const mappings = [
    { dbColumn: 'id', jsField: 'id' },
    { dbColumn: 'organization_id', jsField: 'organizationId' },
    { dbColumn: 'name', jsField: 'name' },
    { dbColumn: 'file_path', jsField: 'filePath' },
    { dbColumn: 'mime_type', jsField: 'mimeType' },
    { dbColumn: 'size', jsField: 'size' },
    { dbColumn: 'version', jsField: 'version' },
    { dbColumn: 'uploaded_by', jsField: 'uploadedBy' },
    { dbColumn: 'record_id', jsField: 'recordId' },
    { dbColumn: 'created_at', jsField: 'createdAt' },
    { dbColumn: 'updated_at', jsField: 'updatedAt' }
];
const DocumentModel = (0, PgModel_1.createPgModel)('documents', mappings);
exports.default = DocumentModel;
