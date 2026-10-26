"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PgModel_1 = require("./PgModel");
const mappings = [
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
const UserModel = (0, PgModel_1.createPgModel)('users', mappings);
exports.default = UserModel;
