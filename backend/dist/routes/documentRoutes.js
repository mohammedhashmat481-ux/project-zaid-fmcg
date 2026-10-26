"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const Document_1 = __importDefault(require("../models/Document"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const hierarchy_1 = require("../utils/hierarchy");
const uploadPaths_1 = require("../utils/uploadPaths");
const router = (0, express_1.Router)();
// Configure local file uploads storage folder
const uploadDir = (0, uploadPaths_1.getUploadDir)();
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path_1.default.extname(file.originalname));
    }
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});
router.use(authMiddleware_1.authenticate);
router.use(tenantMiddleware_1.requireTenant);
// 1. Upload file
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'No file uploaded.' });
            return;
        }
        const { recordId } = req.body;
        const doc = await Document_1.default.create({
            organizationId: req.organizationId,
            name: req.file.originalname,
            filePath: `/uploads/${req.file.filename}`, // relative static URL path
            mimeType: req.file.mimetype,
            size: req.file.size,
            version: 1,
            uploadedBy: req.user?.id,
            recordId: recordId || undefined
        });
        res.status(201).json(doc);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to upload document.' });
    }
});
// 2. List documents
router.get('/', async (req, res) => {
    try {
        const query = { organizationId: req.organizationId };
        if (req.query.recordId) {
            query.recordId = req.query.recordId;
        }
        await hierarchy_1.HierarchyService.modifyDocumentQuery(query, req.user, req.organizationId);
        const docs = await Document_1.default.find(query)
            .populate('uploadedBy', 'firstName lastName')
            .sort({ createdAt: -1 });
        res.status(200).json(docs);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to list documents.' });
    }
});
// 3. Delete document
router.delete('/:id', async (req, res) => {
    try {
        const doc = await Document_1.default.findOne({
            _id: req.params.id,
            organizationId: req.organizationId
        });
        if (!doc) {
            res.status(404).json({ error: 'Document not found.' });
            return;
        }
        // Attempt to remove physical file from disk
        const absolutePath = path_1.default.join(__dirname, '../../../', doc.filePath);
        if (fs_1.default.existsSync(absolutePath)) {
            fs_1.default.unlinkSync(absolutePath);
        }
        await Document_1.default.findByIdAndDelete(doc._id);
        res.status(200).json({ message: 'Document deleted successfully.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete document.' });
    }
});
// 4. Update/Rename document
router.put('/:id', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            res.status(400).json({ error: 'Document name is required.' });
            return;
        }
        const doc = await Document_1.default.findOneAndUpdate({ _id: req.params.id, organizationId: req.organizationId }, { name: name.trim() }, { new: true });
        if (!doc) {
            res.status(404).json({ error: 'Document not found.' });
            return;
        }
        res.status(200).json(doc);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update document.' });
    }
});
exports.default = router;
