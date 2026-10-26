"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const LOGS_DIR = path_1.default.resolve(__dirname, '../../../logs');
if (!fs_1.default.existsSync(LOGS_DIR)) {
    fs_1.default.mkdirSync(LOGS_DIR, { recursive: true });
}
const writeLog = (filename, level, message, meta) => {
    const timestamp = new Date().toISOString();
    const logLine = JSON.stringify({ timestamp, level, message, meta }) + '\n';
    try {
        fs_1.default.appendFileSync(path_1.default.join(LOGS_DIR, filename), logLine);
    }
    catch (err) {
        console.error('Failed to write log to file:', err);
    }
};
exports.logger = {
    info: (msg, meta) => {
        console.log(`[INFO] ${msg}`, meta ? JSON.stringify(meta) : '');
        writeLog('combined.log', 'INFO', msg, meta);
    },
    warn: (msg, meta) => {
        console.warn(`[WARN] ${msg}`, meta ? JSON.stringify(meta) : '');
        writeLog('combined.log', 'WARN', msg, meta);
    },
    error: (msg, meta) => {
        console.error(`[ERROR] ${msg}`, meta ? JSON.stringify(meta) : '');
        writeLog('combined.log', 'ERROR', msg, meta);
        writeLog('error.log', 'ERROR', msg, meta);
    },
    access: (method, url, status, responseTimeMs, ip) => {
        const timestamp = new Date().toISOString();
        const logLine = `${timestamp} - ${ip} - ${method} ${url} ${status} - ${responseTimeMs}ms\n`;
        try {
            fs_1.default.appendFileSync(path_1.default.join(LOGS_DIR, 'access.log'), logLine);
        }
        catch (err) {
            console.error('Failed to write access log to file:', err);
        }
    }
};
