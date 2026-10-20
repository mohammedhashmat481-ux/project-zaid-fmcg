import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Document from '../models/Document';
import { authenticate } from '../middleware/authMiddleware';
import { requireTenant } from '../middleware/tenantMiddleware';
import { HierarchyService } from '../utils/hierarchy';
import { getUploadDir } from '../utils/uploadPaths';

const router = Router();

// Configure local file uploads storage folder
const uploadDir = getUploadDir();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

router.use(authenticate);
router.use(requireTenant);

// 1. Upload file
router.post('/upload', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded.' });
      return;
    }

    const { recordId } = req.body;

    const doc = await Document.create({
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to upload document.' });
  }
});

// 2. List documents
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const query: Record<string, any> = { organizationId: req.organizationId };
    
    if (req.query.recordId) {
      query.recordId = req.query.recordId;
    }

    await HierarchyService.modifyDocumentQuery(query, req.user as any, req.organizationId!);

    const docs = await Document.find(query)
      .populate('uploadedBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.status(200).json(docs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list documents.' });
  }
});

// 3. Delete document
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const doc = await Document.findOne({
      _id: req.params.id,
      organizationId: req.organizationId
    });

    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }

    // Attempt to remove physical file from disk
    const absolutePath = path.join(__dirname, '../../../', doc.filePath);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    await Document.findByIdAndDelete(doc._id);
    res.status(200).json({ message: 'Document deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete document.' });
  }
});

// 4. Update/Rename document
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Document name is required.' });
      return;
    }

    const doc = await Document.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.organizationId },
      { name: name.trim() },
      { new: true }
    );

    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }

    res.status(200).json(doc);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update document.' });
  }
});

export default router;
