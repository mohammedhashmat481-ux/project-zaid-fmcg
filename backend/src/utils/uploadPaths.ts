import path from 'path';
import fs from 'fs';

/**
 * Resolves a reliable absolute path to the directory used for uploaded files.
 * Checks environment variable, current working directory, and relative project directories.
 */
export const getUploadDir = (): string => {
  // 1. Explicit environment variable
  if (process.env.UPLOADS_DIR) {
    const dir = path.resolve(process.env.UPLOADS_DIR);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (e) {
        console.error('Failed to create custom UPLOADS_DIR:', e);
      }
    }
    return dir;
  }

  // 2. Candidate paths in order of preference
  const candidates = [
    path.resolve(process.cwd(), 'uploads'),
    path.resolve(__dirname, '../../uploads'),
    path.resolve(__dirname, '../../../uploads'),
    path.resolve(process.cwd(), '../uploads')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // 3. Fallback: create in current working directory
  const primary = path.resolve(process.cwd(), 'uploads');
  if (!fs.existsSync(primary)) {
    try {
      fs.mkdirSync(primary, { recursive: true });
    } catch (e) {
      console.error('Failed to create default uploads directory:', e);
    }
  }
  return primary;
};
