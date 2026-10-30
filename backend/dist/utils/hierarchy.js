"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HierarchyService = void 0;
const User_1 = __importDefault(require("../models/User"));
const Role_1 = __importDefault(require("../models/Role"));
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
class HierarchyService {
    static async isSuperAdmin(roleId) {
        if (!roleId)
            return false;
        try {
            const role = await Role_1.default.findById(roleId);
            if (!role)
                return false;
            const lower = (role.name || '').toLowerCase();
            return lower === 'main admin' || lower === 'super admin' || lower === 'admin' || lower === 'administrator' || lower === 'org admin' || lower === 'organization admin';
        }
        catch (e) {
            return false;
        }
    }
    static async getSubordinateUserIds(userId, orgId) {
        const allUsers = await User_1.default.find({ organizationId: orgId }).select('_id reportingManager');
        const userMap = new Map();
        allUsers.forEach((u) => {
            if (u.reportingManager) {
                const managerIdStr = u.reportingManager.toString();
                if (!userMap.has(managerIdStr)) {
                    userMap.set(managerIdStr, []);
                }
                userMap.get(managerIdStr).push(u._id.toString());
            }
        });
        const descendants = [];
        const queue = [userId.toString()];
        while (queue.length > 0) {
            const current = queue.shift();
            const subs = userMap.get(current) || [];
            subs.forEach(s => {
                if (!descendants.includes(s)) {
                    descendants.push(s);
                    queue.push(s);
                }
            });
        }
        return descendants;
    }
    static async modifyRecordQuery(query, reqUser, orgId) {
        // Skip hierarchy filtering for settings/metadata modules
        if (query.moduleId) {
            try {
                const moduleDef = await ModuleDefinition_1.default.findById(query.moduleId);
                if (moduleDef && moduleDef.apiPath) {
                    const settingsPaths = ['bankmasters', 'bankingpartners', 'products', 'departments'];
                    if (settingsPaths.includes(moduleDef.apiPath.toLowerCase())) {
                        return;
                    }
                }
            }
            catch (e) {
                // ignore and continue
            }
        }
        const isSuper = await this.isSuperAdmin(reqUser.roleId);
        if (isSuper)
            return;
        const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
        const allowedUserIds = [String(reqUser.id), ...descendants];
        const allowedUsers = await User_1.default.find({ _id: { $in: allowedUserIds } }).select('_id firstName lastName email userCode');
        const searchCriteria = [
            { createdBy: { $in: allowedUserIds } },
            { 'data.assignedTo': { $in: allowedUserIds.map(id => id.toString()) } }
        ];
        allowedUsers.forEach((u) => {
            const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
            if (fullName) {
                const escName = fullName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                searchCriteria.push({ 'data.assignedTo': new RegExp('^\\s*' + escName + '\\s*$', 'i') });
            }
            if (u.email) {
                const escEmail = u.email.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                searchCriteria.push({ 'data.assignedTo': new RegExp('^\\s*' + escEmail + '\\s*$', 'i') });
            }
            if (u.userCode) {
                const escCode = u.userCode.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                searchCriteria.push({ 'data.assignedTo': new RegExp('^\\s*' + escCode + '\\s*$', 'i') });
            }
        });
        const hierarchyFilter = { $or: searchCriteria };
        if (query.$or) {
            const existingOr = query.$or;
            delete query.$or;
            query.$and = [
                { $or: existingOr },
                hierarchyFilter
            ];
        }
        else if (query.$and) {
            query.$and.push(hierarchyFilter);
        }
        else {
            Object.assign(query, hierarchyFilter);
        }
    }
    static async modifyUserQuery(query, reqUser, orgId) {
        const isSuper = await this.isSuperAdmin(reqUser.roleId);
        if (isSuper)
            return;
        const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
        const allowedUserIds = [String(reqUser.id), ...descendants];
        query._id = { $in: allowedUserIds };
    }
    static async modifyAuditLogQuery(query, reqUser, orgId) {
        const isSuper = await this.isSuperAdmin(reqUser.roleId);
        if (isSuper)
            return;
        const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
        const allowedUserIds = [String(reqUser.id), ...descendants];
        query.userId = { $in: allowedUserIds };
    }
    static async modifyDocumentQuery(query, reqUser, orgId) {
        const isSuper = await this.isSuperAdmin(reqUser.roleId);
        if (isSuper)
            return;
        const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
        const allowedUserIds = [String(reqUser.id), ...descendants];
        query.uploadedBy = { $in: allowedUserIds };
    }
    static async checkRecordAccess(record, reqUser, orgId) {
        // Skip hierarchy check for settings/metadata modules
        if (record.moduleId) {
            try {
                const moduleDef = await ModuleDefinition_1.default.findById(record.moduleId);
                if (moduleDef && moduleDef.apiPath) {
                    const settingsPaths = ['bankmasters', 'bankingpartners', 'products', 'departments'];
                    if (settingsPaths.includes(moduleDef.apiPath.toLowerCase())) {
                        return true;
                    }
                }
            }
            catch (e) {
                // ignore and continue
            }
        }
        const isSuper = await this.isSuperAdmin(reqUser.roleId);
        if (isSuper)
            return true;
        const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
        const allowedUserIds = [reqUser.id.toString(), ...descendants.map(id => id.toString())];
        const creatorId = record.createdBy ? record.createdBy.toString() : '';
        if (allowedUserIds.includes(creatorId))
            return true;
        const assignedTo = record.data?.get ? record.data.get('assignedTo') : record.data?.assignedTo;
        if (!assignedTo)
            return false;
        const allowedUsers = await User_1.default.find({ _id: { $in: allowedUserIds } }).select('_id firstName lastName email userCode');
        for (const u of allowedUsers) {
            if (assignedTo === u._id.toString())
                return true;
            const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
            if (fullName && assignedTo.trim().toLowerCase() === fullName.toLowerCase())
                return true;
            if (u.email && assignedTo.trim().toLowerCase() === u.email.toLowerCase())
                return true;
            if (u.userCode && assignedTo.trim().toLowerCase() === u.userCode.toLowerCase())
                return true;
        }
        return false;
    }
}
exports.HierarchyService = HierarchyService;
