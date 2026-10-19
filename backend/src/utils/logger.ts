import fs from 'fs';
import path from 'path';

const LOGS_DIR = path.resolve(__dirname, '../../../logs');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const writeLog = (filename: string, level: string, message: string, meta?: any) => {
  const timestamp = new Date().toISOString();
  const logLine = JSON.stringify({ timestamp, level, message, meta }) + '\n';
  try {
    fs.appendFileSync(path.join(LOGS_DIR, filename), logLine);
  } catch (err) {
    console.error('Failed to write log to file:', err);
  }
};

export const logger = {
  info: (msg: string, meta?: any) => {
    console.log(`[INFO] ${msg}`, meta ? JSON.stringify(meta) : '');
    writeLog('combined.log', 'INFO', msg, meta);
  },
  warn: (msg: string, meta?: any) => {
    console.warn(`[WARN] ${msg}`, meta ? JSON.stringify(meta) : '');
    writeLog('combined.log', 'WARN', msg, meta);
  },
  error: (msg: string, meta?: any) => {
    console.error(`[ERROR] ${msg}`, meta ? JSON.stringify(meta) : '');
    writeLog('combined.log', 'ERROR', msg, meta);
    writeLog('error.log', 'ERROR', msg, meta);
  },
  access: (method: string, url: string, status: number, responseTimeMs: number, ip: string) => {
    const timestamp = new Date().toISOString();
    const logLine = `${timestamp} - ${ip} - ${method} ${url} ${status} - ${responseTimeMs}ms\n`;
    try {
      fs.appendFileSync(path.join(LOGS_DIR, 'access.log'), logLine);
    } catch (err) {
      console.error('Failed to write access log to file:', err);
    }
  }
};
