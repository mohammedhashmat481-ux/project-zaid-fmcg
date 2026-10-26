"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateMongoToPostgres = migrateMongoToPostgres;
const mongoose_1 = __importDefault(require("mongoose"));
const postgres_1 = require("../config/postgres");
const Organization_1 = __importDefault(require("../models/Organization"));
const Role_1 = __importDefault(require("../models/Role"));
const User_1 = __importDefault(require("../models/User"));
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
const Activity_1 = __importDefault(require("../models/Activity"));
const AuditLog_1 = __importDefault(require("../models/AuditLog"));
const Document_1 = __importDefault(require("../models/Document"));
const Notification_1 = __importDefault(require("../models/Notification"));
const Status_1 = __importDefault(require("../models/Status"));
const Workflow_1 = __importDefault(require("../models/Workflow"));
const ReportDefinition_1 = __importDefault(require("../models/ReportDefinition"));
const DashboardLayout_1 = __importDefault(require("../models/DashboardLayout"));
async function migrateMongoToPostgres() {
    console.log('=== STARTING MONGODB TO POSTGRESQL DATA MIGRATION ===');
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/project_zaid';
    console.log(`Connecting to MongoDB at ${mongoUri}...`);
    try {
        await mongoose_1.default.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
        console.log('MongoDB connected successfully.');
    }
    catch (err) {
        console.log(`Could not connect to MongoDB at ${mongoUri} (${err.message}). Skipping MongoDB data import.`);
        await (0, postgres_1.connectPostgres)();
        return;
    }
    await (0, postgres_1.connectPostgres)();
    const db = mongoose_1.default.connection.db;
    if (!db) {
        console.error('MongoDB database object not available.');
        return;
    }
    // 1. Migrate Organizations
    const orgs = await db.collection('organizations').find({}).toArray();
    console.log(`Migrating ${orgs.length} Organization(s)...`);
    for (const doc of orgs) {
        const cleanDoc = mapMongoDoc(doc);
        const existing = await Organization_1.default.findById(cleanDoc._id);
        if (!existing) {
            await Organization_1.default.create(cleanDoc);
        }
    }
    // 2. Migrate Roles
    const roles = await db.collection('roles').find({}).toArray();
    console.log(`Migrating ${roles.length} Role(s)...`);
    for (const doc of roles) {
        const cleanDoc = mapMongoDoc(doc);
        const existing = await Role_1.default.findById(cleanDoc._id);
        if (!existing) {
            await Role_1.default.create(cleanDoc);
        }
    }
    // 3. Migrate Users
    const users = await db.collection('users').find({}).toArray();
    console.log(`Migrating ${users.length} User(s)...`);
    for (const doc of users) {
        const cleanDoc = mapMongoDoc(doc);
        const existing = await User_1.default.findById(cleanDoc._id);
        if (!existing) {
            await User_1.default.create(cleanDoc);
        }
    }
    // 4. Migrate Module Definitions
    const modules = await db.collection('moduledefinitions').find({}).toArray();
    console.log(`Migrating ${modules.length} ModuleDefinition(s)...`);
    for (const doc of modules) {
        const cleanDoc = mapMongoDoc(doc);
        const existing = await ModuleDefinition_1.default.findById(cleanDoc._id);
        if (!existing) {
            await ModuleDefinition_1.default.create(cleanDoc);
        }
    }
    // 5. Migrate Custom Records
    const records = await db.collection('customrecords').find({}).toArray();
    console.log(`Migrating ${records.length} CustomRecord(s)...`);
    for (const doc of records) {
        const cleanDoc = mapMongoDoc(doc);
        const existing = await CustomRecord_1.default.findById(cleanDoc._id);
        if (!existing) {
            await CustomRecord_1.default.create(cleanDoc);
        }
    }
    // 6. Migrate Activities
    const activities = await db.collection('activities').find({}).toArray();
    console.log(`Migrating ${activities.length} Activity record(s)...`);
    for (const doc of activities) {
        const cleanDoc = mapMongoDoc(doc);
        const existing = await Activity_1.default.findById(cleanDoc._id);
        if (!existing) {
            await Activity_1.default.create(cleanDoc);
        }
    }
    // 7. Migrate Audit Logs
    const auditLogs = await db.collection('auditlogs').find({}).toArray();
    console.log(`Migrating ${auditLogs.length} AuditLog(s)...`);
    for (const doc of auditLogs) {
        const cleanDoc = mapMongoDoc(doc);
        const existing = await AuditLog_1.default.findById(cleanDoc._id);
        if (!existing) {
            await AuditLog_1.default.create(cleanDoc);
        }
    }
    // 8. Migrate Documents
    const documents = await db.collection('documents').find({}).toArray();
    console.log(`Migrating ${documents.length} Document(s)...`);
    for (const doc of documents) {
        const cleanDoc = mapMongoDoc(doc);
        const existing = await Document_1.default.findById(cleanDoc._id);
        if (!existing) {
            await Document_1.default.create(cleanDoc);
        }
    }
    // 9. Migrate Notifications
    const notifications = await db.collection('notifications').find({}).toArray();
    console.log(`Migrating ${notifications.length} Notification(s)...`);
    for (const doc of notifications) {
        const cleanDoc = mapMongoDoc(doc);
        const existing = await Notification_1.default.findById(cleanDoc._id);
        if (!existing) {
            await Notification_1.default.create(cleanDoc);
        }
    }
    // 10. Migrate Statuses
    const statuses = await db.collection('statuses').find({}).toArray();
    console.log(`Migrating ${statuses.length} Status(es)...`);
    for (const doc of statuses) {
        const cleanDoc = mapMongoDoc(doc);
        const existing = await Status_1.default.findById(cleanDoc._id);
        if (!existing) {
            await Status_1.default.create(cleanDoc);
        }
    }
    // 11. Migrate Workflows
    const workflows = await db.collection('workflows').find({}).toArray();
    console.log(`Migrating ${workflows.length} Workflow(s)...`);
    for (const doc of workflows) {
        const cleanDoc = mapMongoDoc(doc);
        const existing = await Workflow_1.default.findById(cleanDoc._id);
        if (!existing) {
            await Workflow_1.default.create(cleanDoc);
        }
    }
    // 12. Migrate Report Definitions
    const reports = await db.collection('reportdefinitions').find({}).toArray();
    console.log(`Migrating ${reports.length} ReportDefinition(s)...`);
    for (const doc of reports) {
        const cleanDoc = mapMongoDoc(doc);
        const existing = await ReportDefinition_1.default.findById(cleanDoc._id);
        if (!existing) {
            await ReportDefinition_1.default.create(cleanDoc);
        }
    }
    // 13. Migrate Dashboard Layouts
    const layouts = await db.collection('dashboardlayouts').find({}).toArray();
    console.log(`Migrating ${layouts.length} DashboardLayout(s)...`);
    for (const doc of layouts) {
        const cleanDoc = mapMongoDoc(doc);
        const existing = await DashboardLayout_1.default.findById(cleanDoc._id);
        if (!existing) {
            await DashboardLayout_1.default.create(cleanDoc);
        }
    }
    console.log('=== MONGODB TO POSTGRESQL MIGRATION COMPLETE ===');
    await mongoose_1.default.disconnect();
}
function mapMongoDoc(doc) {
    if (!doc)
        return doc;
    const copy = { ...doc };
    if (copy._id) {
        copy._id = copy._id.toString();
    }
    Object.keys(copy).forEach((k) => {
        if (copy[k] && typeof copy[k] === 'object' && copy[k]._bsontype === 'ObjectID') {
            copy[k] = copy[k].toString();
        }
    });
    return copy;
}
if (require.main === module) {
    migrateMongoToPostgres()
        .then(() => {
        console.log('Migration script finished successfully.');
        process.exit(0);
    })
        .catch((err) => {
        console.error('Migration script failed:', err);
        process.exit(1);
    });
}
