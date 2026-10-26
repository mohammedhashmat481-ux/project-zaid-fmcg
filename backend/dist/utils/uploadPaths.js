"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUploadDir = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
/**
 * Resolves a reliable absolute path to the directory used for uploaded files.
 * Checks environment variable, current working directory, and relative project directories.
 */
const getUploadDir = () => {
    // 1. Explicit environment variable
    if (process.env.UPLOADS_DIR) {
        const dir = path_1.default.resolve(process.env.UPLOADS_DIR);
        if (!fs_1.default.existsSync(dir)) {
            try {
                fs_1.default.mkdirSync(dir, { recursive: true });
            }
            catch (e) {
                console.error('Failed to create custom UPLOADS_DIR:', e);
            }
        }
        return dir;
    }
    // 2. Candidate paths in order of preference
    const candidates = [
        path_1.default.resolve(process.cwd(), 'uploads'),
        path_1.default.resolve(__dirname, '../../uploads'),
        path_1.default.resolve(__dirname, '../../../uploads'),
        path_1.default.resolve(process.cwd(), '../uploads')
    ];
    for (const candidate of candidates) {
        if (fs_1.default.existsSync(candidate)) {
            return candidate;
        }
    }
    // 3. Fallback: create in current working directory
    const primary = path_1.default.resolve(process.cwd(), 'uploads');
    if (!fs_1.default.existsSync(primary)) {
        try {
            fs_1.default.mkdirSync(primary, { recursive: true });
        }
        catch (e) {
            console.error('Failed to create default uploads directory:', e);
        }
    }
    return primary;
};
exports.getUploadDir = getUploadDir;
