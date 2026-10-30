// inkCRM Enterprise Production Server (Reloaded v7)
import app from './app';
import { connectDB, disconnectDB } from './config/db';
import Organization from './models/Organization';
import ModuleDefinition from './models/ModuleDefinition';
import { seedDatabase } from './utils/seeder';
import { seedDemoData } from './utils/seedDemoData';
import { logger } from './utils/logger';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

// 1. Validate Production Environment Variables
const requiredEnvVars = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingEnvVars.length > 0) {
  logger.error(`FATAL STARTUP ERROR: Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// 2. Validate face credentials decryption key length (must be 32 bytes or 32 chars)
const encryptionKey = process.env.ENCRYPTION_KEY || '';
if (encryptionKey.length < 16) {
  logger.error(`FATAL STARTUP ERROR: ENCRYPTION_KEY must be at least 16 characters for cryptographic strength.`);
  process.exit(1);
}

const PORT = process.env.PORT || 5000;

let server: any;

const startServer = async () => {
  try {
    // Connect to database
    await connectDB();

    // Auto-seed if database is empty
    const count = await Organization.countDocuments();
    if (count === 0) {
      logger.info('No organization tenants detected. Running auto-seeder...');
      await seedDatabase(false);
      await seedDemoData(false);
      logger.info('Auto-seeding and initial demo pipeline completed.');
    }

    // Ensure BankingPartner module definition has required schema fields (bank, loanType, psm)
    try {
      const bpModules = await ModuleDefinition.find({ apiPath: 'bankingpartners' });
      for (const bpMod of bpModules) {
        const hasBankField = bpMod.fields?.some((f: any) => f.name === 'bank');
        if (!hasBankField) {
          logger.info('[Migration] Updating BankingPartner module definition schema fields...');
          await ModuleDefinition.findByIdAndUpdate(bpMod._id || bpMod.id, {
            fields: [
              { name: 'bank', label: 'Bank Name', type: 'text', required: true, unique: false },
              { name: 'loanType', label: 'Loan Type', type: 'text', required: true, unique: false },
              { name: 'psm', label: 'PSM', type: 'text', required: true, unique: false },
              { name: 'partnerName', label: 'Partner Name', type: 'text', required: false, unique: false },
              { name: 'partnerCode', label: 'Partner Code', type: 'text', required: false, unique: false }
            ]
          });
          logger.info('[Migration] BankingPartner module definition schema fields updated successfully.');
        }
      }
    } catch (migErr: any) {
      logger.warn(`[Migration Warning] Could not verify BankingPartner schema: ${migErr.message}`);
    }

    server = app.listen(PORT, () => {
      logger.info(`=================================`);
      logger.info(` inkCRM Backend API Server Running`);
      logger.info(` Port: ${PORT}`);
      logger.info(` Mode: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`=================================`);
    });

    // 3. Configure request timeout (30 seconds)
    server.setTimeout(30000);

  } catch (error: any) {
    console.error('Fatal error starting the server:', error);
    logger.error('Fatal error starting the server:', error?.stack || error?.message || error);
    process.exit(1);
  }
};

// 4. Handle Graceful Shutdown Process
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  if (server) {
    server.close(async () => {
      logger.info('Express server closed.');
      try {
        await disconnectDB();
        logger.info('Database connection closed cleanly.');
        process.exit(0);
      } catch (err) {
        logger.error('Error during database disconnect:', err);
        process.exit(1);
      }
    });

    // Force shutdown after 10 seconds if graceful shutdown hangs
    setTimeout(() => {
      logger.error('Forcing shutdown after timeout.');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
