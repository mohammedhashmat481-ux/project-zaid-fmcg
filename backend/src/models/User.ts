import { createPgModel, FieldMapping } from './PgModel';

export interface IDeviceSession {
  deviceId: string;
  browser: string;
  os: string;
  ip: string;
  lastActive: Date;
}

export interface IRegisteredLocation {
  latitude?: number;
  longitude?: number;
  address?: string;
  capturedAt?: Date;
}

export interface ICurrentLocation {
  latitude?: number;
  longitude?: number;
  address?: string;
  lastUpdated?: Date;
}

export interface ILoginHistoryEntry {
  loginAt: Date;
  ip?: string;
  browser?: string;
  os?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  locationVerificationSkipped?: boolean;
}

export interface IUser {
  _id?: string;
  id?: string;
  organizationId: any;
  roleId: any;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  plainPassword?: string;
  isVerified?: boolean;
  twoFactor?: any;
  faceRecognition?: any;
  registrationLocation?: IRegisteredLocation;
  registeredLocation?: IRegisteredLocation;
  currentLocation?: ICurrentLocation;
  locationVerificationSkipped?: boolean;
  loginHistory?: ILoginHistoryEntry[];
  locationRadius?: number;
  avatarUrl?: string;
  refreshTokens?: string[];
  activeDevices?: IDeviceSession[];
  failedLoginAttempts?: number;
  lastFailedLoginAt?: Date;
  userCode?: string;
  skipFace?: boolean;
  skipLocation?: boolean;
  isActive?: boolean;
  isApproved?: boolean;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  reportingManager?: any;
  department?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const mappings: FieldMapping[] = [
  { dbColumn: 'id', jsField: 'id' },
  { dbColumn: 'organization_id', jsField: 'organizationId' },
  { dbColumn: 'role_id', jsField: 'roleId' },
  { dbColumn: 'first_name', jsField: 'firstName' },
  { dbColumn: 'last_name', jsField: 'lastName' },
  { dbColumn: 'email', jsField: 'email' },
  { dbColumn: 'password_hash', jsField: 'passwordHash' },
  { dbColumn: 'plain_password', jsField: 'plainPassword' },
  { dbColumn: 'is_verified', jsField: 'isVerified' },
  { dbColumn: 'two_factor', jsField: 'twoFactor', isJson: true },
  { dbColumn: 'face_recognition', jsField: 'faceRecognition', isJson: true },
  { dbColumn: 'registered_location', jsField: 'registeredLocation', isJson: true },
  { dbColumn: 'registration_location', jsField: 'registrationLocation', isJson: true },
  { dbColumn: 'current_location', jsField: 'currentLocation', isJson: true },
  { dbColumn: 'location_verification_skipped', jsField: 'locationVerificationSkipped' },
  { dbColumn: 'login_history', jsField: 'loginHistory', isJson: true },
  { dbColumn: 'location_radius', jsField: 'locationRadius' },
  { dbColumn: 'avatar_url', jsField: 'avatarUrl' },
  { dbColumn: 'refresh_tokens', jsField: 'refreshTokens', isJson: true },
  { dbColumn: 'active_devices', jsField: 'activeDevices', isJson: true },
  { dbColumn: 'failed_login_attempts', jsField: 'failedLoginAttempts' },
  { dbColumn: 'last_failed_login_at', jsField: 'lastFailedLoginAt' },
  { dbColumn: 'user_code', jsField: 'userCode' },
  { dbColumn: 'skip_face', jsField: 'skipFace' },
  { dbColumn: 'skip_location', jsField: 'skipLocation' },
  { dbColumn: 'is_active', jsField: 'isActive' },
  { dbColumn: 'is_approved', jsField: 'isApproved' },
  { dbColumn: 'approval_status', jsField: 'approvalStatus' },
  { dbColumn: 'reporting_manager', jsField: 'reportingManager' },
  { dbColumn: 'department', jsField: 'department' },
  { dbColumn: 'created_at', jsField: 'createdAt' },
  { dbColumn: 'updated_at', jsField: 'updatedAt' }
];

const UserModel = createPgModel('users', mappings);
export default UserModel;
