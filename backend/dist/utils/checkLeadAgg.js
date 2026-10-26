"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../config/db");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
const Organization_1 = __importDefault(require("../models/Organization"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
async function main() {
    await (0, db_1.connectDB)();
    const org = await Organization_1.default.findOne();
    const leadModule = await ModuleDefinition_1.default.findOne({ apiPath: 'leads', organizationId: org?._id });
    const leadAgg = await CustomRecord_1.default.aggregate([
        { $match: { moduleId: leadModule?._id, organizationId: org?._id } },
        { $group: { _id: '$data.status', count: { $sum: 1 } } }
    ]);
    console.log('Aggregate results by status:', JSON.stringify(leadAgg, null, 2));
    // Let's verify if there is any status with 0 leads
    await (0, db_1.disconnectDB)();
}
main().catch(console.error);
