"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/inkcrm';
async function run() {
    console.log('Connecting to database:', MONGODB_URI);
    await mongoose_1.default.connect(MONGODB_URI);
    console.log('Connected to MongoDB.');
    const orgs = await mongoose_1.default.connection.db.collection('organizations').find().toArray();
    console.log('Found organizations:', orgs.map(o => o.name));
    if (orgs.length === 0) {
        console.log('No organizations found.');
        await mongoose_1.default.disconnect();
        return;
    }
    const orgId = orgs[0]._id;
    console.log('Using Organization ID:', orgId);
    // Find Lead and Deal Module Definitions
    const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'leads' });
    const dealModule = await ModuleDefinition_1.default.findOne({ organizationId: orgId, apiPath: 'deals' });
    console.log('Lead Module:', leadModule ? 'Found' : 'Not Found');
    console.log('Deal Module:', dealModule ? 'Found' : 'Not Found');
    if (leadModule) {
        console.log('Aggregating leads count by status...');
        const leadAgg = await CustomRecord_1.default.aggregate([
            { $match: { organizationId: orgId, moduleId: leadModule._id } },
            { $group: { _id: '$data.status', count: { $sum: 1 } } }
        ]);
        console.log('Leads aggregation success:', leadAgg);
    }
    if (dealModule) {
        console.log('Aggregating deals grouped by stage for Pipeline...');
        try {
            const dealAgg = await CustomRecord_1.default.aggregate([
                { $match: { organizationId: orgId, moduleId: dealModule._id } },
                { $group: { _id: '$data.stage', total: { $sum: { $toDouble: '$data.amount' } } } }
            ]);
            console.log('Deals aggregation success:', dealAgg);
        }
        catch (err) {
            console.error('DEALS AGGREGATION FAILED:', err);
        }
    }
    console.log('Querying recent activities...');
    try {
        const Activity = require('../models/Activity').default;
        const recentActivities = await Activity.find({ organizationId: orgId })
            .populate('userId', 'firstName lastName')
            .sort({ createdAt: -1 })
            .limit(10);
        console.log('Activities query success:', recentActivities.length);
    }
    catch (err) {
        console.error('ACTIVITIES QUERY FAILED:', err);
    }
    await mongoose_1.default.disconnect();
    console.log('Done.');
}
run().catch(console.error);
