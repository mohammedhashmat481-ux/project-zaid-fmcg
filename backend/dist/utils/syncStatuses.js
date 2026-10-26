"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../config/db");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const Status_1 = __importDefault(require("../models/Status"));
const Organization_1 = __importDefault(require("../models/Organization"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });
const EXACT_11_STATUSES = [
    { name: 'HOT LEADS', icon: 'Flame', color: '#0284C7', category: 'pipeline', pipelinePosition: 2, isFinal: false, dashboardVisibility: true, order: 1 },
    { name: 'WARM LEADS', icon: 'Sun', color: '#F59E0B', category: 'pipeline', pipelinePosition: 3, isFinal: false, dashboardVisibility: true, order: 2 },
    { name: 'CEBIL PENDING', icon: 'FileWarning', color: '#E11D48', category: 'pipeline', pipelinePosition: 5, isFinal: false, dashboardVisibility: true, order: 3 },
    { name: 'DOCUMENT PENDING', icon: 'FileText', color: '#0284C7', category: 'pipeline', pipelinePosition: 6, isFinal: false, dashboardVisibility: true, order: 4 },
    { name: 'APPROVAL PENDING', icon: 'Clock', color: '#EA580C', category: 'pipeline', pipelinePosition: 7, isFinal: false, dashboardVisibility: true, order: 5 },
    { name: 'APPROVED BUT NOT DISBUSE', icon: 'CheckCircle', color: '#F59E0B', category: 'pipeline', pipelinePosition: 8, isFinal: false, dashboardVisibility: true, order: 6 },
    { name: 'DISBUSED', icon: 'Banknote', color: '#16A34A', category: 'pipeline', pipelinePosition: 9, isFinal: true, isSuccess: true, dashboardVisibility: true, order: 7 },
    { name: 'REJECTED', icon: 'XOctagon', color: '#E11D48', category: 'overview', pipelinePosition: 10, isFinal: true, isSuccess: false, dashboardVisibility: true, order: 8 },
    { name: 'FOLLOWUP', icon: 'PhoneCall', color: '#0284C7', category: 'followups', pipelinePosition: 11, isFinal: false, dashboardVisibility: true, order: 9 },
    { name: 'DROPPED', icon: 'ArrowDownCircle', color: '#EA580C', category: 'overview', pipelinePosition: 12, isFinal: true, isSuccess: false, dashboardVisibility: true, order: 10 },
    { name: 'PENDING', icon: 'Hourglass', color: '#F59E0B', category: 'followups', pipelinePosition: 13, isFinal: false, dashboardVisibility: true, order: 11 }
];
async function main() {
    await (0, db_1.connectDB)();
    const org = await Organization_1.default.findOne();
    if (!org)
        return;
    await Status_1.default.deleteMany({ organizationId: org._id });
    for (const st of EXACT_11_STATUSES) {
        await Status_1.default.create({
            ...st,
            organizationId: org._id
        });
    }
    const allStatuses = await Status_1.default.find({ organizationId: org._id }).sort({ order: 1 });
    console.log('Total Statuses in DB now:', allStatuses.length);
    await (0, db_1.disconnectDB)();
}
main().catch(console.error);
