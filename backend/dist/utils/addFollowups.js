"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../config/db");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const Organization_1 = __importDefault(require("../models/Organization"));
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
const User_1 = __importDefault(require("../models/User"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
async function addFollowups() {
    try {
        await (0, db_1.connectDB)();
        // 1. Get organization for sales subdomain
        const org = await Organization_1.default.findOne({ subdomain: 'sales' });
        if (!org) {
            console.error('Organization with subdomain "sales" not found.');
            return;
        }
        // 2. Find Lead Module Definition
        const leadModule = await ModuleDefinition_1.default.findOne({
            organizationId: org._id,
            apiPath: 'leads'
        });
        if (!leadModule) {
            console.error('Leads module definition not found.');
            return;
        }
        // 3. Find a user in the organization to assign as creator
        const user = await User_1.default.findOne({ organizationId: org._id });
        if (!user) {
            console.error('No user found for organization.');
            return;
        }
        // 4. Create today's date in local time
        const today = new Date(); // local current time (July 10, 2026)
        console.log('Setting followUpDate to:', today.toISOString());
        // 5. Create 3 new followup leads
        const followupLeads = [
            {
                firstName: 'Vikram',
                lastName: 'Sen',
                email: 'vikram.sen@gmail.com',
                phone: '9888777666',
                status: 'Followup',
                loanType: 'LAP (LOAN AGAINST PROPERTY)',
                budget: 4500000,
                source: 'Website',
                bankName: 'Axis Bank',
                followUpDate: today,
                notes: 'Interested in property loan. Schedule site verification.'
            },
            {
                firstName: 'Neha',
                lastName: 'Patel',
                email: 'neha.patel@yahoo.com',
                phone: '9777666555',
                status: 'Followup',
                loanType: 'SALARIED PERSONAL LOAN',
                budget: 800000,
                source: 'Referral',
                bankName: 'KOTAK Bank',
                followUpDate: today,
                notes: 'Needs quick personal loan for emergency. Call at 2:00 PM.'
            },
            {
                firstName: 'Rohan',
                lastName: 'Mehta',
                email: 'rohan.mehta@outlook.com',
                phone: '9666555444',
                status: 'Followup',
                loanType: 'BUSINESS LOAN',
                budget: 2500000,
                source: 'Cold Call',
                bankName: 'ICICI Bank',
                followUpDate: today,
                notes: 'Requires working capital for warehouse expansion.'
            }
        ];
        for (const lead of followupLeads) {
            const record = await CustomRecord_1.default.create({
                organizationId: org._id,
                moduleId: leadModule._id,
                createdBy: user._id,
                updatedBy: user._id,
                data: lead
            });
            console.log(`Successfully added lead: ${lead.firstName} ${lead.lastName} (ID: ${record._id})`);
        }
        console.log('Successfully seeded 3 today followup leads!');
    }
    catch (error) {
        console.error('Error adding followups:', error);
    }
    finally {
        await (0, db_1.disconnectDB)();
    }
}
addFollowups();
