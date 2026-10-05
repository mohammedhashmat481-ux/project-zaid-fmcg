declare global {
  namespace Express {
    interface Request {
      organizationId?: any;
      permissionScope?: string;
      user?: {
        id: string;
        email: string;
        roleId: string;
        organizationId: string;
      };
    }
  }
}

export {};
