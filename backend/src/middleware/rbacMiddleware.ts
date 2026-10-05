import { Request, Response, NextFunction } from 'express';
import Role from '../models/Role';

// Extend Request interface for permission scopes
declare global {
  namespace Express {
    interface Request {
      permissionScope?: 'all' | 'own';
    }
  }
}

const matchModuleName = (permName: string, targetName: string): boolean => {
  const p = permName.toLowerCase();
  const t = targetName.toLowerCase();
  if (p === t) return true;
  if (p === t + 's' || t === p + 's') return true;
  if (p === t.replace(/y$/, 'ies') || t === p.replace(/y$/, 'ies')) return true;
  return false;
};

export const checkPermission = (
  moduleName: string,
  action: 'create' | 'read' | 'update' | 'delete'
) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized. Authenticated user required.' });
        return;
      }

      const role = await Role.findById(req.user.roleId);
      if (!role) {
        res.status(403).json({ error: 'Access Denied. User role not found.' });
        return;
      }

      // Bypass checks for Super Admin
      if (role.name === 'Super Admin' && role.isSystem) {
        req.permissionScope = 'all';
        return next();
      }

      // Find module permission configuration using singular/plural helper
      const modulePerm = role.permissions.modules.find(
        (p: any) => matchModuleName(p.moduleName, moduleName)
      );

      if (!modulePerm) {
        res.status(403).json({ error: `Access Denied. No permission configured for module: ${moduleName}` });
        return;
      }

      if (action === 'create') {
        if (modulePerm.create) {
          return next();
        } else {
          res.status(403).json({ error: `Access Denied. You do not have create permissions for ${moduleName}` });
          return;
        }
      }

      // Read, Update, Delete check ('all' | 'own' | 'none')
      const actionScope = modulePerm[action]; // will be 'all', 'own', or 'none'

      if (actionScope === 'none') {
        res.status(403).json({ error: `Access Denied. You do not have ${action} permissions for ${moduleName}` });
        return;
      }

      // Attach permission scope to request for controller queries filtering
      req.permissionScope = actionScope;
      next();
    } catch (error) {
      console.error('RBAC Middleware Error:', error);
      res.status(500).json({ error: 'Internal server error validating permissions.' });
    }
  };
};
