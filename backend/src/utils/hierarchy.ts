import User from '../models/User';
import Role from '../models/Role';
import ModuleDefinition from '../models/ModuleDefinition';

export class HierarchyService {
  public static async isSuperAdmin(roleId: any): Promise<boolean> {
    if (!roleId) return false;
    try {
      const role = await Role.findById(roleId);
      if (!role) return false;
      const lower = (role.name || '').toLowerCase();
      return lower === 'main admin' || lower === 'super admin' || lower === 'admin' || lower === 'administrator' || lower === 'org admin' || lower === 'organization admin';
    } catch (e) {
      return false;
    }
  }

  public static async getSubordinateUserIds(
    userId: string,
    orgId: string
  ): Promise<string[]> {
    const allUsers = await User.find({ organizationId: orgId }).select('_id reportingManager');
    
    const userMap = new Map<string, string[]>();
    allUsers.forEach((u: any) => {
      if (u.reportingManager) {
        const managerIdStr = u.reportingManager.toString();
        if (!userMap.has(managerIdStr)) {
          userMap.set(managerIdStr, []);
        }
        userMap.get(managerIdStr)!.push(u._id.toString());
      }
    });

    const descendants: string[] = [];
    const queue: string[] = [userId.toString()];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
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

  public static async modifyRecordQuery(
    query: Record<string, any>,
    reqUser: { id: string; roleId: string },
    orgId: string
  ): Promise<void> {
    // Skip hierarchy filtering for settings/metadata modules
    if (query.moduleId) {
      try {
        const moduleDef = await ModuleDefinition.findById(query.moduleId);
        if (moduleDef && moduleDef.apiPath) {
          const settingsPaths = ['bankmasters', 'bankingpartners', 'products', 'departments'];
          if (settingsPaths.includes(moduleDef.apiPath.toLowerCase())) {
            return;
          }
        }
      } catch (e) {
        // ignore and continue
      }
    }

    if (!reqUser || !reqUser.id) return;
    const isSuper = await this.isSuperAdmin(reqUser.roleId);
    if (isSuper) return;

    const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
    const allowedUserIds = [String(reqUser.id), ...descendants];

    const allowedUsers = await User.find({ _id: { $in: allowedUserIds } }).select('_id firstName lastName email userCode');

    // Collect all valid identity tokens for all allowed users (normalized lowercase trimmed)
    const allowedTokens = new Set<string>();
    allowedUserIds.forEach(id => {
      if (id) allowedTokens.add(String(id).toLowerCase().trim());
    });

    allowedUsers.forEach((u: any) => {
      if (u._id) allowedTokens.add(String(u._id).toLowerCase().trim());
      if (u.id) allowedTokens.add(String(u.id).toLowerCase().trim());
      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase();
      if (fullName) allowedTokens.add(fullName);
      if (u.email) allowedTokens.add(u.email.trim().toLowerCase());
      if (u.userCode) allowedTokens.add(u.userCode.trim().toLowerCase());
    });

    const tokenArray = Array.from(allowedTokens);

    // High-performance index-compatible search criteria using functional LOWER(TRIM(...))
    const searchCriteria: any[] = [
      { createdBy: { $in: allowedUserIds } },
      { 'lower(trim(data.assignedTo))': { $in: tokenArray } },
      { 'lower(trim(data.telecaller))': { $in: tokenArray } }
    ];

    const hierarchyFilter = { $or: searchCriteria };

    if (query.$or) {
      const existingOr = query.$or;
      delete query.$or;
      const existingAnd = Array.isArray(query.$and) ? query.$and : [];
      query.$and = [
        ...existingAnd,
        { $or: existingOr },
        hierarchyFilter
      ];
    } else if (query.$and) {
      query.$and.push(hierarchyFilter);
    } else {
      Object.assign(query, hierarchyFilter);
    }
  }

  public static async modifyUserQuery(
    query: Record<string, any>,
    reqUser: { id: string; roleId: string },
    orgId: string
  ): Promise<void> {
    if (!reqUser || !reqUser.id) return;
    const isSuper = await this.isSuperAdmin(reqUser.roleId);
    if (isSuper) return;

    const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
    const allowedUserIds = [String(reqUser.id), ...descendants];

    query._id = { $in: allowedUserIds };
  }

  public static async modifyAuditLogQuery(
    query: Record<string, any>,
    reqUser: { id: string; roleId: string },
    orgId: string
  ): Promise<void> {
    if (!reqUser || !reqUser.id) return;
    const isSuper = await this.isSuperAdmin(reqUser.roleId);
    if (isSuper) return;

    const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
    const allowedUserIds = [String(reqUser.id), ...descendants];

    query.userId = { $in: allowedUserIds };
  }

  public static async modifyDocumentQuery(
    query: Record<string, any>,
    reqUser: { id: string; roleId: string },
    orgId: string
  ): Promise<void> {
    if (!reqUser || !reqUser.id) return;
    const isSuper = await this.isSuperAdmin(reqUser.roleId);
    if (isSuper) return;

    const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
    const allowedUserIds = [String(reqUser.id), ...descendants];

    query.uploadedBy = { $in: allowedUserIds };
  }

  public static async checkRecordAccess(
    record: any,
    reqUser: { id: string; roleId: string },
    orgId: string
  ): Promise<boolean> {
    // Skip hierarchy check for settings/metadata modules
    if (record.moduleId) {
      try {
        const moduleDef = await ModuleDefinition.findById(record.moduleId);
        if (moduleDef && moduleDef.apiPath) {
          const settingsPaths = ['bankmasters', 'bankingpartners', 'products', 'departments'];
          if (settingsPaths.includes(moduleDef.apiPath.toLowerCase())) {
            return true;
          }
        }
      } catch (e) {
        // ignore and continue
      }
    }

    const isSuper = await this.isSuperAdmin(reqUser.roleId);
    if (isSuper) return true;

    const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
    const allowedUserIds = [reqUser.id.toString(), ...descendants.map(id => id.toString())];

    const creatorId = record.createdBy ? record.createdBy.toString() : '';
    if (allowedUserIds.includes(creatorId)) return true;

    const assignedTo = record.data?.get ? record.data.get('assignedTo') : record.data?.assignedTo;
    if (!assignedTo) return false;

    const allowedUsers = await User.find({ _id: { $in: allowedUserIds } }).select('_id firstName lastName email userCode');

    for (const u of allowedUsers) {
      if (assignedTo === u._id.toString()) return true;
      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
      if (fullName && assignedTo.trim().toLowerCase() === fullName.toLowerCase()) return true;
      if (u.email && assignedTo.trim().toLowerCase() === u.email.toLowerCase()) return true;
      if (u.userCode && assignedTo.trim().toLowerCase() === u.userCode.toLowerCase()) return true;
    }

    return false;
  }
}
