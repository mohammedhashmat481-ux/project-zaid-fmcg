"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// inkCRM Enterprise Production Server (Reloaded v7)
const app_1 = __importDefault(require("./app"));
const db_1 = require("./config/db");
const Organization_1 = __importDefault(require("./models/Organization"));
const ModuleDefinition_1 = __importDefault(require("./models/ModuleDefinition"));
const seeder_1 = require("./utils/seeder");
const seedDemoData_1 = require("./utils/seedDemoData");
const logger_1 = require("./utils/logger");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });
dotenv_1.default.config();
// 1. Validate Production Environment Variables
const requiredEnvVars = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingEnvVars.length > 0) {
    logger_1.logger.error(`FATAL STARTUP ERROR: Missing required environment variables: ${missingEnvVars.join(', ')}`);
    process.exit(1);
}
// 2. Validate face credentials decryption key length (must be 32 bytes or 32 chars)
const encryptionKey = process.env.ENCRYPTION_KEY || '';
if (encryptionKey.length < 16) {
    logger_1.logger.error(`FATAL STARTUP ERROR: ENCRYPTION_KEY must be at least 16 characters for cryptographic strength.`);
    process.exit(1);
}
const PORT = process.env.PORT || 5000;
let server;
const startServer = async () => {
    try {
        // Connect to database
        await (0, db_1.connectDB)();
        // Auto-seed if database is empty
        const count = await Organization_1.default.countDocuments();
        if (count === 0) {
            logger_1.logger.info('No organization tenants detected. Running auto-seeder...');
            await (0, seeder_1.seedDatabase)(false);
            await (0, seedDemoData_1.seedDemoData)(false);
            logger_1.logger.info('Auto-seeding and initial demo pipeline completed.');
        }
        // Ensure BankingPartner module definition has required schema fields (bank, loanType, psm)
        try {
            const bpModules = await ModuleDefinition_1.default.find({ apiPath: 'bankingpartners' });
            for (const bpMod of bpModules) {
                const hasBankField = bpMod.fields?.some((f) => f.name === 'bank');
                if (!hasBankField) {
                    logger_1.logger.info('[Migration] Updating BankingPartner module definition schema fields...');
                    await ModuleDefinition_1.default.findByIdAndUpdate(bpMod._id || bpMod.id, {
                        fields: [
                            { name: 'bank', label: 'Bank Name', type: 'text', required: true, unique: false },
                            { name: 'loanType', label: 'Loan Type', type: 'text', required: true, unique: false },
                            { name: 'psm', label: 'PSM', type: 'text', required: true, unique: false },
                            { name: 'partnerName', label: 'Partner Name', type: 'text', required: false, unique: false },
                            { name: 'partnerCode', label: 'Partner Code', type: 'text', required: false, unique: false }
                        ]
                    });
                    logger_1.logger.info('[Migration] BankingPartner module definition schema fields updated successfully.');
                }
            }
        }
        catch (migErr) {
            logger_1.logger.warn(`[Migration Warning] Could not verify BankingPartner schema: ${migErr.message}`);
        }
        server = app_1.default.listen(PORT, () => {
            logger_1.logger.info(`=================================`);
            logger_1.logger.info(` inkCRM Backend API Server Running`);
            logger_1.logger.info(` Port: ${PORT}`);
            logger_1.logger.info(` Mode: ${process.env.NODE_ENV || 'development'}`);
            logger_1.logger.info(`=================================`);
        });
        // 3. Configure request timeout (30 seconds)
        server.setTimeout(30000);
    }
    catch (error) {
        console.error('Fatal error starting the server:', error);
        logger_1.logger.error('Fatal error starting the server:', error?.stack || error?.message || error);
        process.exit(1);
    }
};
// 4. Handle Graceful Shutdown Process
const gracefulShutdown = async (signal) => {
    logger_1.logger.info(`Received ${signal}. Starting graceful shutdown...`);
    if (server) {
        server.close(async () => {
            logger_1.logger.info('Express server closed.');
            try {
                await (0, db_1.disconnectDB)();
                logger_1.logger.info('Database connection closed cleanly.');
                process.exit(0);
            }
            catch (err) {
                logger_1.logger.error('Error during database disconnect:', err);
                process.exit(1);
            }
        });
        // Force shutdown after 10 seconds if graceful shutdown hangs
        setTimeout(() => {
            logger_1.logger.error('Forcing shutdown after timeout.');
            process.exit(1);
        }, 10000);
    }
    else {
        process.exit(0);
    }
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
startServer();
