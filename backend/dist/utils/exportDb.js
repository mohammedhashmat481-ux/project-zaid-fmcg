"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../config/db");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Import models
const Organization_1 = __importDefault(require("../models/Organization"));
const Role_1 = __importDefault(require("../models/Role"));
const User_1 = __importDefault(require("../models/User"));
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
const DashboardLayout_1 = __importDefault(require("../models/DashboardLayout"));
const Workflow_1 = __importDefault(require("../models/Workflow"));
const Status_1 = __importDefault(require("../models/Status"));
const AuditLog_1 = __importDefault(require("../models/AuditLog"));
const Document_1 = __importDefault(require("../models/Document"));
const Activity_1 = __importDefault(require("../models/Activity"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
const dumpDir = path_1.default.resolve(__dirname, '../../../database-dump');
async function exportDb() {
    try {
        await (0, db_1.connectDB)();
        // Ensure output directory exists
        if (!fs_1.default.existsSync(dumpDir)) {
            fs_1.default.mkdirSync(dumpDir, { recursive: true });
        }
        const collections = [
            { name: 'organizations', model: Organization_1.default },
            { name: 'roles', model: Role_1.default },
            { name: 'users', model: User_1.default },
            { name: 'moduledefinitions', model: ModuleDefinition_1.default },
            { name: 'customrecords', model: CustomRecord_1.default },
            { name: 'dashboardlayouts', model: DashboardLayout_1.default },
            { name: 'workflows', model: Workflow_1.default },
            { name: 'statuses', model: Status_1.default },
            { name: 'auditlogs', model: AuditLog_1.default },
            { name: 'documents', model: Document_1.default },
            { name: 'activities', model: Activity_1.default }
        ];
        for (const col of collections) {
            console.log(`Exporting ${col.name}...`);
            const data = await col.model.find({}).lean();
            const filePath = path_1.default.join(dumpDir, `${col.name}.json`);
            fs_1.default.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            console.log(`Saved ${data.length} records to ${filePath}`);
        }
        console.log('Database export completed successfully!');
    }
    catch (error) {
        console.error('Failed to export database:', error);
    }
    finally {
        await (0, db_1.disconnectDB)();
    }
}
exportDb();
