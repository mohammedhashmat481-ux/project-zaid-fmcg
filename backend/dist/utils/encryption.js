"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.euclideanDistance = euclideanDistance;
const crypto_1 = __importDefault(require("crypto"));
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'super_secret_face_encryption_key'; // Must be 32 bytes in production
const IV_LENGTH = 16; // For AES, this is always 16
// Ensure the key is exactly 32 bytes (256 bits) for aes-256-cbc
const normalizedKey = crypto_1.default.createHash('sha256').update(String(ENCRYPTION_KEY)).digest('base64').substring(0, 32);
function encrypt(text) {
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv('aes-256-cbc', Buffer.from(normalizedKey), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}
function decrypt(text) {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', Buffer.from(normalizedKey), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}
/**
 * Calculates Euclidean distance between two Face Embeddings (arrays of numbers)
 * Lower distance means higher similarity.
 * face-api.js typically uses a threshold of 0.6. We use 0.55 for strict enterprise security.
 */
function euclideanDistance(arr1, arr2) {
    if (arr1.length !== arr2.length) {
        throw new Error('Embeddings must have the same length');
    }
    let sum = 0;
    for (let i = 0; i < arr1.length; i++) {
        sum += Math.pow(arr1[i] - arr2[i], 2);
    }
    return Math.sqrt(sum);
}
