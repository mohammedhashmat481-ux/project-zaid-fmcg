"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCampaignModules = syncCampaignModules;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../config/db");
const Organization_1 = __importDefault(require("../models/Organization"));
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
const Role_1 = __importDefault(require("../models/Role"));
const logger_1 = require("./logger");
dotenv_1.default.config();
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });
dotenv_1.default.config({ path: path_1.default.resolve(process.cwd(), 'backend/.env') });
async function syncCampaignModules() {
    await (0, db_1.connectDB)();
    logger_1.logger.info('[Sync] Checking and synchronizing Campaign modules...');
    const organizations = await Organization_1.default.find({});
    for (const org of organizations) {
        logger_1.logger.info(`[Sync] Processing organization: ${org.name} (${org._id})`);
        // 1. Ensure enabledModules includes campaigns and campaignassignments
        let orgUpdated = false;
        const currentEnabled = Array.isArray(org.enabledModules) ? [...org.enabledModules] : [];
        if (!currentEnabled.includes('campaigns')) {
            currentEnabled.push('campaigns');
            orgUpdated = true;
        }
        if (!currentEnabled.includes('campaignassignments')) {
            currentEnabled.push('campaignassignments');
            orgUpdated = true;
        }
        if (orgUpdated) {
            org.enabledModules = currentEnabled;
            await org.save();
            logger_1.logger.info(`[Sync] Updated enabledModules for org ${org.name}`);
        }
        // 2. Check/create Campaign module
        let campaignModule = await ModuleDefinition_1.default.findOne({ organizationId: org._id, apiPath: 'campaigns' });
        if (!campaignModule) {
            campaignModule = await ModuleDefinition_1.default.create({
                organizationId: org._id,
                name: 'Campaign',
                singularLabel: 'Campaign',
                pluralLabel: 'Campaigns',
                apiPath: 'campaigns',
                icon: 'Target',
                isSystem: true,
                fields: [
                    { name: 'campaignName', label: 'Campaign Name', type: 'text', required: true, unique: true },
                    {
                        name: 'status',
                        label: 'Status',
                        type: 'dropdown',
                        required: true,
                        unique: false,
                        defaultValue: 'Planned',
                        options: ['Planned', 'Active', 'Completed', 'Cancelled']
                    },
                    {
                        name: 'type',
                        label: 'Type',
                        type: 'dropdown',
                        required: true,
                        unique: false,
                        defaultValue: 'Email',
                        options: ['Email', 'Social Media', 'Cold Call', 'Webinar', 'Event']
                    },
                    { name: 'budget', label: 'Budget', type: 'currency', required: false, unique: false },
                    { name: 'startDate', label: 'Start Date', type: 'date', required: false, unique: false },
                    { name: 'endDate', label: 'End Date', type: 'date', required: false, unique: false },
                    { name: 'notes', label: 'Notes', type: 'rich-text', required: false, unique: false }
                ]
            });
            logger_1.logger.info(`[Sync] Created Campaign module for org ${org.name}`);
        }
        else {
            logger_1.logger.info(`[Sync] Campaign module already exists for org ${org.name}`);
        }
        // 3. Check/create CampaignAssignment module
        let campaignAssignmentModule = await ModuleDefinition_1.default.findOne({ organizationId: org._id, apiPath: 'campaignassignments' });
        if (!campaignAssignmentModule) {
            campaignAssignmentModule = await ModuleDefinition_1.default.create({
                organizationId: org._id,
                name: 'CampaignAssignment',
                singularLabel: 'Campaign Assignment',
                pluralLabel: 'Campaign Assignments',
                apiPath: 'campaignassignments',
                icon: 'UserCheck',
                isSystem: true,
                fields: [
                    { name: 'assignmentName', label: 'Assignment Title', type: 'text', required: true, unique: false },
                    { name: 'campaign', label: 'Campaign', type: 'dropdown', required: true, unique: false, options: [] },
                    { name: 'lead', label: 'Assigned Lead', type: 'dropdown', required: true, unique: false, options: [] },
                    { name: 'assignedDate', label: 'Assigned Date', type: 'date', required: true, unique: false }
                ]
            });
            logger_1.logger.info(`[Sync] Created CampaignAssignment module for org ${org.name}`);
        }
        else {
            logger_1.logger.info(`[Sync] CampaignAssignment module already exists for org ${org.name}`);
        }
        // 4. Update roles to ensure campaigns and campaignassignments permissions are granted
        const roles = await Role_1.default.find({ organizationId: org._id });
        for (const role of roles) {
            let roleUpdated = false;
            const menus = Array.isArray(role.permissions?.menus) ? [...role.permissions.menus] : [];
            if (!menus.includes('campaigns')) {
                menus.push('campaigns');
                roleUpdated = true;
            }
            if (!menus.includes('campaignassignments')) {
                menus.push('campaignassignments');
                roleUpdated = true;
            }
            const modules = Array.isArray(role.permissions?.modules) ? [...role.permissions.modules] : [];
            if (!modules.some((m) => m.moduleName === 'campaigns')) {
                modules.push({ moduleName: 'campaigns', create: true, read: 'all', update: 'all', delete: 'all' });
                roleUpdated = true;
            }
            if (!modules.some((m) => m.moduleName === 'campaignassignments')) {
                modules.push({ moduleName: 'campaignassignments', create: true, read: 'all', update: 'all', delete: 'all' });
                roleUpdated = true;
            }
            if (roleUpdated) {
                role.permissions = {
                    ...role.permissions,
                    menus,
                    modules
                };
                await role.save();
                logger_1.logger.info(`[Sync] Updated role permissions for: ${role.name}`);
            }
        }
    }
    logger_1.logger.info('[Sync] Campaign synchronization completed successfully.');
    await (0, db_1.disconnectDB)();
}
if (require.main === module) {
    syncCampaignModules()
        .then(() => process.exit(0))
        .catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
