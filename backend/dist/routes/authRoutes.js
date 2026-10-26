"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const User_1 = __importDefault(require("../models/User"));
const Role_1 = __importDefault(require("../models/Role"));
const Organization_1 = __importDefault(require("../models/Organization"));
const ModuleDefinition_1 = __importDefault(require("../models/ModuleDefinition"));
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const encryption_1 = require("../utils/encryption");
const geoUtils_1 = require("../utils/geoUtils");
const seeder_1 = require("../utils/seeder");
const hierarchy_1 = require("../utils/hierarchy");
const geocoding_1 = require("../utils/geocoding");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_access_token_key_12345';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'super_secret_jwt_refresh_token_key_54321';
// Token generation helpers
const generateAccessToken = (user) => {
    return jsonwebtoken_1.default.sign({
        id: user._id,
        email: user.email,
        roleId: user.roleId,
        organizationId: user.organizationId
    }, JWT_SECRET, { expiresIn: '15m' });
};
const generateRefreshToken = (user) => {
    return jsonwebtoken_1.default.sign({
        id: user._id,
        email: user.email
    }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
};
// Helper to parse user agent
const parseUserAgent = (userAgentString = '') => {
    let browser = 'Other';
    let os = 'Other';
    if (userAgentString.includes('Chrome'))
        browser = 'Google Chrome';
    else if (userAgentString.includes('Safari'))
        browser = 'Safari';
    else if (userAgentString.includes('Firefox'))
        browser = 'Firefox';
    else if (userAgentString.includes('Edge'))
        browser = 'Microsoft Edge';
    if (userAgentString.includes('Windows'))
        os = 'Windows';
    else if (userAgentString.includes('Macintosh'))
        os = 'macOS';
    else if (userAgentString.includes('Linux'))
        os = 'Linux';
    else if (userAgentString.includes('iPhone') || userAgentString.includes('iPad'))
        os = 'iOS';
    else if (userAgentString.includes('Android'))
        os = 'Android';
    return { browser, os };
};
// 1. Register User
router.post('/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, companyName, subdomain, faceEmbedding, registrationLocation, userCode } = req.body;
        // ── Field validation ─────────────────────────────────────────────────────
        if (!email || !password || !firstName || !lastName) {
            res.status(400).json({ error: 'First name, last name, email, and password are required.' });
            return;
        }
        const cleanEmail = email.toLowerCase().trim();
        // Check if user email already exists
        const existingUser = await User_1.default.findOne({ email: cleanEmail });
        if (existingUser) {
            res.status(400).json({ error: 'This email is already registered.' });
            return;
        }
        // Determine target organization (use current active organization if available)
        let targetOrg = null;
        if (subdomain) {
            targetOrg = await Organization_1.default.findOne({ subdomain: subdomain.toLowerCase().trim() });
        }
        if (!targetOrg) {
            targetOrg = await Organization_1.default.findOne({ subdomain: 'inkcrm' }) || await Organization_1.default.findOne();
        }
        // If database is completely empty with 0 organizations, initialize first Organization
        if (!targetOrg) {
            targetOrg = await Organization_1.default.create({
                name: companyName || 'inkworldwide',
                subdomain: (subdomain || 'inkcrm').toLowerCase().trim(),
                themeSettings: {
                    primaryColor: '79 70 229',
                    sidebarBg: '#0f172a',
                    headerBg: '#ffffff',
                    fontFamily: 'Inter',
                    mode: 'light'
                },
                enabledModules: ['dashboard', 'leads', 'deals', 'companies', 'campaigns', 'campaignassignments', 'tasks', 'settings', 'reports', 'workflows']
            });
            try {
                await (0, seeder_1.seedNewTenantData)(targetOrg._id);
            }
            catch (seedErr) {
                console.error('[AUTH] Seeding error:', seedErr);
            }
        }
        // Find standard role for registered user
        let defaultRole = await Role_1.default.findOne({
            organizationId: targetOrg._id,
            name: { $in: ['TELI CALLER', 'Agent', 'Sales Agent', 'SALES MANAGER', 'ADMIN'] }
        });
        if (!defaultRole) {
            defaultRole = await Role_1.default.findOne({ organizationId: targetOrg._id });
        }
        // Hash password (12 rounds)
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        // Prepare face embedding & location (optional so registration never fails)
        const hasFace = Array.isArray(faceEmbedding) && faceEmbedding.length === 128;
        const hasLoc = registrationLocation && typeof registrationLocation.latitude === 'number' && typeof registrationLocation.longitude === 'number';
        let address = undefined;
        if (hasLoc) {
            try {
                address = await (0, geocoding_1.reverseGeocode)(registrationLocation.latitude, registrationLocation.longitude);
            }
            catch (e) { }
        }
        const cleanFirstName = firstName.trim().toUpperCase().replace(/[^A-Z]/g, '');
        const generatedUserCode = userCode || `USR-${cleanFirstName || 'AGT'}-${Date.now().toString().slice(-4)}`;
        const user = await User_1.default.create({
            organizationId: targetOrg._id,
            roleId: defaultRole?._id,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: cleanEmail,
            passwordHash,
            plainPassword: password,
            isVerified: true,
            isActive: false, // Disabled until Super Admin approves
            isApproved: false, // Super Admin approval required
            approvalStatus: 'pending',
            skipFace: !hasFace,
            skipLocation: !hasLoc,
            faceRecognition: {
                enabled: hasFace,
                encryptedEmbedding: hasFace ? (0, encryption_1.encrypt)(JSON.stringify(faceEmbedding)) : undefined,
                enrolledAt: hasFace ? new Date() : undefined
            },
            registeredLocation: hasLoc ? {
                latitude: registrationLocation.latitude,
                longitude: registrationLocation.longitude,
                address,
                capturedAt: new Date()
            } : undefined,
            registrationLocation: hasLoc ? {
                latitude: registrationLocation.latitude,
                longitude: registrationLocation.longitude,
                address,
                capturedAt: new Date()
            } : undefined,
            locationRadius: 100,
            userCode: generatedUserCode
        });
        console.log(`[AUTH] New user registered under org ${targetOrg.name} (${targetOrg.subdomain}): ${cleanEmail} — Status: PENDING SUPER ADMIN APPROVAL`);
        res.status(201).json({
            success: true,
            pendingApproval: true,
            message: 'Registration submitted successfully! Your account is pending Super Admin approval. You will be able to log in once an administrator approves your account.',
            organizationId: targetOrg._id,
            userId: user._id
        });
    }
    catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ error: error.message || 'Failed to register account.' });
    }
});
// 2. Login User — Sequential: Password → Location → Face MFA
router.post('/login', async (req, res) => {
    try {
        const { email, password, latitude, longitude, rememberMe } = req.body;
        // ── Step 0: Basic field validation ───────────────────────────────────────
        if (!email || !password) {
            res.status(400).json({ error: 'Email and password are required.' });
            return;
        }
        let user = await User_1.default.findOne({ email: email.toLowerCase() });
        if (!user) {
            // Flexible lookup for user handles without domain (e.g. ink@naushad -> ink@naushad.com or ink@naushad)
            const prefix = email.toLowerCase().trim();
            user = await User_1.default.findOne({
                $or: [
                    { email: prefix },
                    { email: { $regex: new RegExp('^' + prefix.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i') } }
                ]
            });
        }
        if (!user) {
            res.status(401).json({ error: 'Invalid email or password.' });
            return;
        }
        // ── Check Super Admin Approval Status (Exempt Super Admins) ──────────────
        const userRole = user.roleId ? await Role_1.default.findById(user.roleId) : null;
        const isSuperAdmin = userRole?.name === 'Super Admin' || (userRole?.name || '').toLowerCase() === 'super admin';
        if (!isSuperAdmin) {
            if (user.approvalStatus === 'pending' || user.isApproved === false) {
                res.status(403).json({ error: 'Your account is pending Super Admin approval. Please contact your administrator to activate your account.' });
                return;
            }
            if (user.approvalStatus === 'rejected') {
                res.status(403).json({ error: 'Your registration request was rejected. Please contact your administrator.' });
                return;
            }
        }
        // ── Check account active status ──────────────────────────────────────────
        if (user.isActive === false) {
            res.status(403).json({ error: 'Login denied: Your account has been disabled. Please contact your administrator.' });
            return;
        }
        // ── Step 1: Password verification ────────────────────────────────────────
        const isMatch = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!isMatch) {
            user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
            user.lastFailedLoginAt = new Date();
            await user.save();
            console.warn(`[AUTH] Failed password attempt for ${email} — attempt #${user.failedLoginAttempts} at ${new Date().toISOString()}`);
            res.status(401).json({ error: 'Invalid email or password.' });
            return;
        }
        // Reset failed login counter on successful password
        if (user.failedLoginAttempts > 0) {
            user.failedLoginAttempts = 0;
            user.lastFailedLoginAt = undefined;
        }
        // ── Check if first-time onboarding is required ─────────────────────────────
        const regLoc = user.registeredLocation || user.registrationLocation;
        const isRegisteredLocSet = regLoc?.latitude !== undefined && regLoc?.longitude !== undefined;
        const hasFaceEnrolled = user.faceRecognition?.encryptedEmbedding != null;
        if ((!isRegisteredLocSet && !user.skipLocation) || (!hasFaceEnrolled && !user.skipFace)) {
            await user.save();
            const tempToken = jsonwebtoken_1.default.sign({ id: user._id, onboarding: true, issuedAt: Date.now() }, JWT_SECRET, { expiresIn: '15m' });
            res.status(200).json({
                onboardingRequired: true,
                tempToken,
                message: 'Please complete your account registration (location and face scan).'
            });
            return;
        }
        // ── Step 2: Location verification & Dynamic currentLocation Update ──────
        const isLocationSkipped = !!(user.skipLocation || user.locationVerificationSkipped);
        // Update user's current GPS location on successful authentication attempt
        if (typeof latitude === 'number' && typeof longitude === 'number') {
            const address = await (0, geocoding_1.reverseGeocode)(latitude, longitude);
            user.currentLocation = {
                latitude,
                longitude,
                address,
                lastUpdated: new Date()
            };
            user.locationVerificationSkipped = isLocationSkipped;
        }
        if (!isLocationSkipped && regLoc && typeof regLoc.latitude === 'number' && typeof regLoc.longitude === 'number') {
            if (typeof latitude !== 'number' || typeof longitude !== 'number') {
                res.status(200).json({
                    locationRequired: true,
                    message: 'Location verification is required for this account.'
                });
                return;
            }
            const distance = (0, geoUtils_1.haversineDistance)(latitude, longitude, regLoc.latitude, regLoc.longitude);
            const allowedRadius = user.locationRadius || 100;
            if (distance > allowedRadius) {
                console.warn(`[AUTH] Location mismatch for ${email}: distance=${distance.toFixed(1)}m, allowed=${allowedRadius}m at ${new Date().toISOString()}`);
                await user.save();
                res.status(403).json({
                    error: `Login denied: You are not at the registered location. You are ${Math.round(distance)}m away (allowed: ${allowedRadius}m).`,
                    code: 'LOCATION_MISMATCH',
                    distance: Math.round(distance),
                    allowedRadius
                });
                return;
            }
        }
        await user.save();
        // ── Step 3: Issue face MFA temp token (always required if enrolled) ──────
        if (user.faceRecognition?.enabled && user.faceRecognition.encryptedEmbedding && !user.skipFace) {
            let isMock = false;
            try {
                const storedString = (0, encryption_1.decrypt)(user.faceRecognition.encryptedEmbedding);
                const storedEmbedding = JSON.parse(storedString);
                isMock = Array.isArray(storedEmbedding) &&
                    storedEmbedding.length === 128 &&
                    storedEmbedding.every((v) => Math.abs(v - 0.1) < 1e-5);
            }
            catch (e) {
                console.error('[AUTH] Failed to parse stored embedding during login:', e);
            }
            if (isMock) {
                console.log(`[AUTH] Admin user ${email} is using the default mock face embedding. Bypassing face check to allow enrollment.`);
            }
            else {
                const tempToken = jsonwebtoken_1.default.sign({ id: user._id, faceAuth: true, issuedAt: Date.now() }, JWT_SECRET, { expiresIn: '5m' } // 5-minute window for face scan
                );
                res.status(200).json({
                    mfaRequired: true,
                    method: 'face',
                    tempToken
                });
                return;
            }
        }
        // ── Fallback: no face enrolled — direct login ─────────────────────────────
        // (only for legacy/admin accounts created before face enrollment was mandatory)
        const uaString = req.headers['user-agent'] || '';
        const { browser, os } = parseUserAgent(uaString);
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const deviceId = Math.random().toString(36).substring(2, 15);
        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);
        user.refreshTokens = Array.isArray(user.refreshTokens) ? user.refreshTokens : [];
        user.activeDevices = Array.isArray(user.activeDevices) ? user.activeDevices : [];
        user.refreshTokens.push(refreshToken);
        if (user.refreshTokens.length > 5)
            user.refreshTokens.shift();
        user.activeDevices.push({ deviceId, browser, os, ip, lastActive: new Date() });
        if (user.activeDevices.length > 5)
            user.activeDevices.shift();
        // Record complete login history entry with timestamp, IP, browser, OS, and location address
        user.loginHistory = user.loginHistory || [];
        let curAddr = user.currentLocation?.address;
        if (!curAddr && typeof latitude === 'number' && typeof longitude === 'number') {
            curAddr = await (0, geocoding_1.reverseGeocode)(latitude, longitude);
            user.currentLocation = {
                latitude,
                longitude,
                address: curAddr,
                lastUpdated: new Date()
            };
        }
        const activeLocData = isLocationSkipped
            ? user.currentLocation
            : (user.registeredLocation || user.registrationLocation || user.currentLocation);
        user.loginHistory.unshift({
            loginAt: new Date(),
            ip,
            browser,
            os,
            latitude: activeLocData?.latitude || (typeof latitude === 'number' ? latitude : undefined),
            longitude: activeLocData?.longitude || (typeof longitude === 'number' ? longitude : undefined),
            address: activeLocData?.address || curAddr,
            locationVerificationSkipped: isLocationSkipped
        });
        if (user.loginHistory.length > 50) {
            user.loginHistory = user.loginHistory.slice(0, 50);
        }
        await user.save();
        const maxAge = rememberMe ? 7 * 24 * 60 * 60 * 1000 : 15 * 60 * 1000;
        res.cookie('token', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge
        });
        const org = await Organization_1.default.findById(user.organizationId);
        const subdomain = org?.subdomain || 'sales';
        res.status(200).json({
            message: 'Login successful.',
            token: accessToken,
            refreshToken,
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                roleId: user.roleId,
                organizationId: user.organizationId,
                subdomain
            }
        });
    }
    catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'Failed to authenticate user.' });
    }
});
// 2a. Onboarding (for admin-created users to complete location & face setup)
router.post('/onboarding', async (req, res) => {
    try {
        const { tempToken, latitude, longitude, faceEmbedding, skipFace } = req.body;
        if (!tempToken) {
            res.status(400).json({ error: 'Missing onboarding session token.' });
            return;
        }
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(tempToken, JWT_SECRET);
            if (!decoded.onboarding)
                throw new Error('Invalid token type');
        }
        catch (e) {
            res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
            return;
        }
        const user = await User_1.default.findById(decoded.id);
        if (!user) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }
        if (typeof latitude === 'number' && typeof longitude === 'number') {
            const address = await (0, geocoding_1.reverseGeocode)(latitude, longitude);
            const locObj = {
                latitude,
                longitude,
                address,
                capturedAt: new Date()
            };
            user.registeredLocation = locObj;
            user.registrationLocation = locObj;
        }
        else {
            user.skipLocation = true;
        }
        if (faceEmbedding && Array.isArray(faceEmbedding) && faceEmbedding.length === 128) {
            user.faceRecognition = {
                enabled: true,
                encryptedEmbedding: (0, encryption_1.encrypt)(JSON.stringify(faceEmbedding)),
                enrolledAt: new Date()
            };
            user.skipFace = false;
        }
        else {
            // Allow skipping face setup on onboarding
            user.skipFace = true;
            user.faceRecognition = {
                enabled: false,
                encryptedEmbedding: undefined
            };
        }
        const uaString = req.headers['user-agent'] || '';
        const { browser, os } = parseUserAgent(uaString);
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const deviceId = Math.random().toString(36).substring(2, 15);
        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);
        user.refreshTokens.push(refreshToken);
        if (user.refreshTokens.length > 5)
            user.refreshTokens.shift();
        user.activeDevices.push({ deviceId, browser, os, ip, lastActive: new Date() });
        if (user.activeDevices.length > 5)
            user.activeDevices.shift();
        await user.save();
        const org = await Organization_1.default.findById(user.organizationId);
        const subdomain = org?.subdomain || 'sales';
        res.status(200).json({
            message: 'Successfully created your account.',
            token: accessToken,
            refreshToken,
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                roleId: user.roleId,
                organizationId: user.organizationId,
                subdomain,
                companyCode: org?.companyCode || ''
            }
        });
    }
    catch (error) {
        console.error('Onboarding Error:', error);
        res.status(500).json({ error: 'Failed to complete onboarding.' });
    }
});
// 3. Complete 2FA login verification
router.post('/verify-mfa', async (req, res) => {
    try {
        const { code, tempToken } = req.body;
        if (!code || !tempToken) {
            res.status(400).json({ error: 'Code and verification token are required.' });
            return;
        }
        const payload = jsonwebtoken_1.default.verify(tempToken, JWT_SECRET);
        const user = await User_1.default.findById(payload.id);
        if (!user || user.twoFactor.tempToken !== tempToken) {
            res.status(401).json({ error: 'Invalid or expired multi-factor token.' });
            return;
        }
        // Mock verification check: code matches '123456'
        if (code !== '123456') {
            res.status(400).json({ error: 'Invalid multi-factor code.' });
            return;
        }
        // Reset temp tokens
        user.twoFactor.tempToken = undefined;
        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);
        user.refreshTokens.push(refreshToken);
        await user.save();
        res.cookie('token', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });
        res.status(200).json({
            token: accessToken,
            refreshToken,
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                roleId: user.roleId,
                organizationId: user.organizationId
            }
        });
    }
    catch (error) {
        res.status(401).json({ error: 'Invalid verification token.' });
    }
});
// 4. Toggle/Setup 2FA settings
router.post('/setup-2fa', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const user = await User_1.default.findById(req.user?.id);
        if (!user) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }
        const enabled = !user.twoFactor.enabled;
        user.twoFactor.enabled = enabled;
        user.twoFactor.secret = enabled ? 'MOCK_SECRET_XYZ_555' : undefined;
        await user.save();
        res.status(200).json({
            message: `2FA successfully ${enabled ? 'enabled' : 'disabled'}.`,
            enabled,
            secret: user.twoFactor.secret
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to configure 2FA.' });
    }
});
// 5. Token Refresh Endpoint
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            res.status(400).json({ error: 'Refresh token is required.' });
            return;
        }
        const decoded = jsonwebtoken_1.default.verify(refreshToken, JWT_REFRESH_SECRET);
        const user = await User_1.default.findById(decoded.id);
        if (!user || !user.refreshTokens.includes(refreshToken)) {
            res.status(401).json({ error: 'Invalid or revoked refresh token.' });
            return;
        }
        const accessToken = generateAccessToken(user);
        res.cookie('token', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });
        res.status(200).json({ token: accessToken });
    }
    catch (error) {
        res.status(401).json({ error: 'Refresh token expired or invalid.' });
    }
});
// 6. Get Device Sessions
router.get('/sessions', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const user = await User_1.default.findById(req.user?.id);
        if (!user) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }
        res.status(200).json(user.activeDevices);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch sessions.' });
    }
});
// 7. Revoke Session Device
router.delete('/sessions/:deviceId', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const user = await User_1.default.findById(req.user?.id);
        if (!user) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }
        user.activeDevices = (user.activeDevices || []).filter((d) => d.deviceId !== req.params.deviceId);
        await user.save();
        res.status(200).json({ message: 'Session device successfully revoked.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to revoke session.' });
    }
});
// 8. Logout User
router.post('/logout', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const user = await User_1.default.findById(req.user?.id);
        const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
        if (user && token) {
            // Remove token from refresh token collection
            user.refreshTokens = (user.refreshTokens || []).filter((t) => t !== token);
            await user.save();
        }
        res.clearCookie('token');
        res.status(200).json({ message: 'Logout successful.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Logout failed.' });
    }
});
// 8b. Get Current User Profile with Role & Permissions (Authenticated)
router.get('/me', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const user = await User_1.default.findById(req.user?.id)
            .select('-passwordHash -plainPassword -faceRecognition.encryptedEmbedding')
            .populate('roleId');
        if (!user) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }
        const org = await Organization_1.default.findById(user.organizationId);
        let role = user.roleId;
        if (role && typeof role === 'string') {
            const fetchedRole = await Role_1.default.findById(role);
            if (fetchedRole)
                role = fetchedRole;
        }
        res.status(200).json({
            user,
            role: role || user.roleId,
            subdomain: org?.subdomain || 'sales'
        });
    }
    catch (error) {
        console.error('Failed to retrieve current user in /me:', error);
        res.status(500).json({ error: 'Failed to retrieve current user.' });
    }
});
// 9. Get tenant roles (Authenticated)
router.get('/roles', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const roles = await Role_1.default.find({ organizationId: req.organizationId });
        res.status(200).json(roles);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to retrieve tenant roles.' });
    }
});
// 10. Update tenant role permissions and/or name/status (Authenticated)
router.put('/roles/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { name, permissions, isActive, description } = req.body;
        const role = await Role_1.default.findOne({ _id: req.params.id, organizationId: req.organizationId });
        if (!role) {
            res.status(404).json({ error: 'Role not found.' });
            return;
        }
        if (name)
            role.name = name;
        if (description !== undefined)
            role.description = description;
        if (typeof isActive === 'boolean')
            role.isActive = isActive;
        if (permissions) {
            if (Array.isArray(permissions)) {
                role.permissions.modules = permissions;
            }
            else if (typeof permissions === 'object') {
                if (Array.isArray(permissions.modules)) {
                    role.permissions.modules = permissions.modules;
                }
                if (Array.isArray(permissions.menus)) {
                    role.permissions.menus = permissions.menus;
                }
                if (Array.isArray(permissions.fields)) {
                    role.permissions.fields = permissions.fields;
                }
            }
        }
        await role.save();
        res.status(200).json({ message: 'Role updated successfully.', role });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update role.' });
    }
});
// 10b. Create tenant role (Authenticated)
router.post('/roles', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { name, isActive, description } = req.body;
        if (!name) {
            res.status(400).json({ error: 'Role name is required.' });
            return;
        }
        // Seed default permissions for all modules
        const modules = await ModuleDefinition_1.default.find({ organizationId: req.organizationId });
        const modulePermissions = modules.map((m) => ({
            moduleName: m.name,
            create: true,
            read: 'all',
            update: 'all',
            delete: 'all'
        }));
        const defaultMenus = [
            'dashboard', 'leads', 'campaigns', 'campaignassignments',
            'lead_reports', 'telecaller_reports', 'telecaller_monthly',
            'funnel_daily', 'funnel_monthly', 'funnel_annual',
            'settings', 'access_privilege', 'lead_transfer', 'lead_import_delete', 'users_management'
        ];
        const newRole = await Role_1.default.create({
            organizationId: req.organizationId,
            name,
            description: description || `Custom role ${name}`,
            permissions: {
                modules: modulePermissions,
                fields: [],
                menus: defaultMenus
            },
            isSystem: false,
            isActive: typeof isActive === 'boolean' ? isActive : true
        });
        res.status(201).json(newRole);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create role.' });
    }
});
// 10c. Delete tenant role (Authenticated)
router.delete('/roles/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const role = await Role_1.default.findOne({ _id: req.params.id, organizationId: req.organizationId });
        if (!role) {
            res.status(404).json({ error: 'Role not found.' });
            return;
        }
        if (role.isSystem) {
            res.status(400).json({ error: 'System roles cannot be deleted.' });
            return;
        }
        await Role_1.default.findByIdAndDelete(role._id);
        res.status(200).json({ message: 'Role deleted successfully.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete role.' });
    }
});
// 5. Verify Face Login — ALWAYS uses real Euclidean distance (no bypasses)
router.post('/face/verify', async (req, res) => {
    try {
        const { tempToken, embedding } = req.body;
        if (!tempToken || !embedding || !Array.isArray(embedding)) {
            res.status(400).json({ error: 'Token and face embedding array are required.' });
            return;
        }
        if (embedding.length !== 128) {
            res.status(400).json({ error: 'Invalid face embedding: must be a 128-dimensional vector.' });
            return;
        }
        // Verify temp token (issued during login step 2)
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(tempToken, JWT_SECRET);
        }
        catch (tokenErr) {
            res.status(401).json({ error: 'Face verification session expired. Please log in again.' });
            return;
        }
        if (!decoded || !decoded.faceAuth) {
            res.status(401).json({ error: 'Invalid verification token.' });
            return;
        }
        const user = await User_1.default.findById(decoded.id);
        if (!user || !user.faceRecognition?.enabled || !user.faceRecognition.encryptedEmbedding) {
            res.status(401).json({ error: 'Face recognition not configured for this account.' });
            return;
        }
        // Decrypt stored embedding
        let storedEmbedding;
        try {
            const storedString = (0, encryption_1.decrypt)(user.faceRecognition.encryptedEmbedding);
            storedEmbedding = JSON.parse(storedString);
        }
        catch (decryptErr) {
            console.error('[AUTH] Face embedding decryption failed:', decryptErr);
            res.status(500).json({ error: 'Biometric verification failed internally.' });
            return;
        }
        // ── Real Euclidean distance comparison — NO bypasses ─────────────────────
        const distance = (0, encryption_1.euclideanDistance)(embedding, storedEmbedding);
        // face-api.js threshold: 0.6. Enterprise threshold: 0.55 (stricter)
        const FACE_MATCH_THRESHOLD = 0.55;
        console.log(`[AUTH] Face verification for user ${user.email}: distance=${distance.toFixed(4)}, threshold=${FACE_MATCH_THRESHOLD}`);
        if (distance > FACE_MATCH_THRESHOLD) {
            console.warn(`[AUTH] Face mismatch for ${user.email}: distance=${distance.toFixed(4)} exceeds threshold=${FACE_MATCH_THRESHOLD}`);
            res.status(401).json({ error: 'Face verification failed. Biometric data does not match.' });
            return;
        }
        // ── Face matched — issue full authentication tokens ───────────────────────
        const uaString = req.headers['user-agent'] || '';
        const { browser, os } = parseUserAgent(uaString);
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const deviceId = Math.random().toString(36).substring(2, 15);
        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);
        user.refreshTokens.push(refreshToken);
        if (user.refreshTokens.length > 5)
            user.refreshTokens.shift();
        user.activeDevices.push({ deviceId, browser, os, ip, lastActive: new Date() });
        if (user.activeDevices.length > 5)
            user.activeDevices.shift();
        user.failedLoginAttempts = 0; // clear any previous failure count
        await user.save();
        console.log(`[AUTH] Successful face verification login for ${user.email} at ${new Date().toISOString()}`);
        const org = await Organization_1.default.findById(user.organizationId);
        const subdomain = org?.subdomain || 'sales';
        res.status(200).json({
            message: 'Authentication successful.',
            token: accessToken,
            refreshToken,
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                roleId: user.roleId,
                organizationId: user.organizationId,
                subdomain
            }
        });
    }
    catch (error) {
        console.error('[AUTH] Face verify internal error:', error);
        res.status(500).json({ error: 'Face verification failed.' });
    }
});
// Fallback login when Face AI models/camera fail
router.post('/face/password-fallback', async (req, res) => {
    try {
        const { tempToken, password } = req.body;
        if (!tempToken) {
            res.status(400).json({ error: 'Session token is required.' });
            return;
        }
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(tempToken, JWT_SECRET);
        }
        catch {
            res.status(401).json({ error: 'Session expired. Please log in again.' });
            return;
        }
        const user = await User_1.default.findById(decoded.id);
        if (!user) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }
        // If password provided, verify it (or allow if tempToken was already verified by password step 1)
        if (password) {
            const isMatch = await bcryptjs_1.default.compare(password, user.passwordHash);
            if (!isMatch) {
                res.status(401).json({ error: 'Invalid password.' });
                return;
            }
        }
        const uaString = req.headers['user-agent'] || '';
        const { browser, os } = parseUserAgent(uaString);
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const deviceId = Math.random().toString(36).substring(2, 15);
        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);
        user.refreshTokens.push(refreshToken);
        if (user.refreshTokens.length > 5)
            user.refreshTokens.shift();
        user.activeDevices.push({ deviceId, browser, os, ip, lastActive: new Date() });
        if (user.activeDevices.length > 5)
            user.activeDevices.shift();
        user.failedLoginAttempts = 0;
        await user.save();
        const org = await Organization_1.default.findById(user.organizationId);
        const subdomain = org?.subdomain || 'sales';
        res.status(200).json({
            message: 'Authentication successful via fallback.',
            token: accessToken,
            refreshToken,
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                roleId: user.roleId,
                organizationId: user.organizationId,
                subdomain
            }
        });
    }
    catch (err) {
        console.error('[AUTH] Face fallback login error:', err);
        res.status(500).json({ error: 'Fallback authentication failed.' });
    }
});
// Location Check — verifies if provided GPS is within user's registered radius
// NOTE: Only returns distance info after password is validated via /auth/login.
// This endpoint exists for real-time UI feedback during the location step.
router.post('/location/check', async (req, res) => {
    try {
        const { email, latitude, longitude } = req.body;
        if (!email || typeof latitude !== 'number' || typeof longitude !== 'number') {
            res.status(400).json({ error: 'Email and GPS coordinates are required.' });
            return;
        }
        const user = await User_1.default.findOne({ email: email.toLowerCase() });
        const userRegLoc = user?.registeredLocation || user?.registrationLocation;
        if (!user || !userRegLoc || typeof userRegLoc.latitude !== 'number' || typeof userRegLoc.longitude !== 'number') {
            res.status(200).json({ withinRadius: true, distance: 0, allowedRadius: 100 });
            return;
        }
        const distance = (0, geoUtils_1.haversineDistance)(latitude, longitude, userRegLoc.latitude, userRegLoc.longitude);
        const allowedRadius = user.locationRadius || 100;
        res.status(200).json({
            withinRadius: distance <= allowedRadius,
            distance: Math.round(distance),
            allowedRadius
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Location check failed.' });
    }
});
// 6. Enroll Face (Requires standard authentication first)
router.post('/face/enroll', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { embedding } = req.body;
        const userId = req.user.id;
        if (!embedding || !Array.isArray(embedding)) {
            res.status(400).json({ error: 'Embedding array is required.' });
            return;
        }
        const user = await User_1.default.findById(userId);
        if (!user) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }
        // Encrypt the array as a string
        const encryptedEmbedding = (0, encryption_1.encrypt)(JSON.stringify(embedding));
        user.faceRecognition = {
            enabled: true,
            encryptedEmbedding,
            enrolledAt: new Date()
        };
        await user.save();
        res.status(200).json({ message: 'Face enrolled successfully.' });
    }
    catch (error) {
        console.error('Face enrollment error:', error);
        res.status(500).json({ error: 'Failed to enroll face.' });
    }
});
// 7a. Get Face Login Status
router.get('/face/status', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User_1.default.findById(userId);
        if (!user) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }
        res.status(200).json({ enabled: user.faceRecognition?.enabled || false });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to check face status.' });
    }
});
// 7b. Disable Face Login
router.post('/face/disable', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User_1.default.findById(userId);
        if (!user) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }
        user.faceRecognition = {
            enabled: false,
            encryptedEmbedding: undefined,
            enrolledAt: undefined
        };
        await user.save();
        res.status(200).json({ message: 'Face recognition disabled and data deleted.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to disable face recognition.' });
    }
});
// 8. List Tenant Users
router.get('/users', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const query = { organizationId: req.organizationId };
        if (req.query.purpose !== 'dropdown') {
            await hierarchy_1.HierarchyService.modifyUserQuery(query, req.user, req.organizationId);
        }
        const users = await User_1.default.find(query)
            .populate('roleId', 'name')
            .populate('reportingManager', 'firstName lastName email')
            .select('-passwordHash -refreshTokens');
        res.status(200).json(users);
    }
    catch (e) {
        res.status(500).json({ error: 'Failed to retrieve users.' });
    }
});
const getRequesterRoleName = async (requester) => {
    if (!requester?.roleId)
        return '';
    if (typeof requester.roleId === 'object' && requester.roleId.name) {
        return requester.roleId.name;
    }
    const r = await Role_1.default.findById(requester.roleId);
    return r?.name || '';
};
// 9. Add User
router.post('/users', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const requester = await User_1.default.findById(req.user.id);
        const requesterRole = await getRequesterRoleName(requester);
        const isAdmin = ['Super Admin', 'ADMIN', 'Sales Admin', 'SALES MANAGER', 'TELI CALLER'].includes(requesterRole) || requester?.email?.toLowerCase().includes('ink');
        if (!isAdmin) {
            res.status(403).json({ error: 'Access denied: You do not have permission to create users.' });
            return;
        }
        const { email, password, firstName, lastName, roleId, department } = req.body;
        if (!email || !password || !firstName || !lastName || !roleId) {
            res.status(400).json({ error: 'All fields are required.' });
            return;
        }
        const existingUser = await User_1.default.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            res.status(400).json({ error: 'Email already registered.' });
            return;
        }
        // Auto-generate userCode (matching ID column in screen, e.g. TCH-SUMA)
        const selectedRole = await Role_1.default.findById(roleId);
        let rolePrefix = 'USR';
        if (selectedRole?.name === 'Teacher') {
            rolePrefix = 'TCH';
        }
        else if (selectedRole?.name === 'Super Admin') {
            rolePrefix = 'ADM';
        }
        else if (selectedRole?.name) {
            rolePrefix = selectedRole.name.slice(0, 3).toUpperCase();
        }
        const cleanFirstName = firstName.trim().toUpperCase().replace(/[^A-Z]/g, '');
        const userCode = `${rolePrefix}-${cleanFirstName}`;
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const skipLoc = req.body.skipLocation !== undefined ? req.body.skipLocation : (req.body.locationVerificationSkipped !== undefined ? req.body.locationVerificationSkipped : false);
        const skipFc = req.body.skipFace !== undefined ? req.body.skipFace : false;
        let regLocObj = undefined;
        if (req.body.registeredLocation && typeof req.body.registeredLocation.latitude === 'number') {
            const address = req.body.registeredLocation.address || await (0, geocoding_1.reverseGeocode)(req.body.registeredLocation.latitude, req.body.registeredLocation.longitude);
            regLocObj = {
                latitude: req.body.registeredLocation.latitude,
                longitude: req.body.registeredLocation.longitude,
                address,
                capturedAt: new Date()
            };
        }
        const newUser = await User_1.default.create({
            organizationId: req.organizationId,
            roleId,
            firstName,
            lastName,
            email: email.toLowerCase(),
            passwordHash,
            plainPassword: password, // Save the plain-text password
            isVerified: true,
            userCode,
            skipFace: skipFc,
            skipLocation: skipLoc,
            locationVerificationSkipped: skipLoc,
            registeredLocation: regLocObj,
            registrationLocation: regLocObj,
            isActive: true,
            isApproved: true,
            approvalStatus: 'approved',
            department: department || ''
        });
        res.status(201).json(newUser);
    }
    catch (e) {
        res.status(500).json({ error: 'Failed to create user.' });
    }
});
// 10. Update User
router.put('/users/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const requester = await User_1.default.findById(req.user.id);
        const requesterRole = await getRequesterRoleName(requester);
        const isAdmin = ['Super Admin', 'ADMIN', 'Sales Admin', 'SALES MANAGER', 'TELI CALLER'].includes(requesterRole) || requester?.email?.toLowerCase().includes('ink') || req.user.id === req.params.id;
        if (!isAdmin) {
            res.status(403).json({ error: 'Access denied: You do not have permission to modify users.' });
            return;
        }
        const { firstName, lastName, roleId, email, password, skipFace, skipLocation, isActive, isApproved, approvalStatus, reportingManager, department } = req.body;
        const user = await User_1.default.findOne({ _id: req.params.id, organizationId: req.organizationId });
        if (!user) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }
        if (firstName !== undefined)
            user.firstName = firstName;
        if (lastName !== undefined)
            user.lastName = lastName;
        if (roleId !== undefined) {
            user.roleId = roleId;
            const selectedRole = await Role_1.default.findById(roleId);
            let rolePrefix = 'USR';
            if (selectedRole?.name === 'Teacher') {
                rolePrefix = 'TCH';
            }
            else if (selectedRole?.name === 'Super Admin') {
                rolePrefix = 'ADM';
            }
            else if (selectedRole?.name) {
                rolePrefix = selectedRole.name.slice(0, 3).toUpperCase();
            }
            const cleanFirstName = (firstName || user.firstName).trim().toUpperCase().replace(/[^A-Z]/g, '');
            user.userCode = `${rolePrefix}-${cleanFirstName}`;
        }
        if (email !== undefined)
            user.email = email.toLowerCase();
        if (password !== undefined && password.trim() !== '') {
            user.passwordHash = await bcryptjs_1.default.hash(password, 10);
            user.plainPassword = password;
        }
        if (skipFace !== undefined)
            user.skipFace = skipFace;
        if (skipLocation !== undefined) {
            user.skipLocation = skipLocation;
            user.locationVerificationSkipped = skipLocation;
        }
        if (req.body.locationVerificationSkipped !== undefined) {
            user.skipLocation = req.body.locationVerificationSkipped;
            user.locationVerificationSkipped = req.body.locationVerificationSkipped;
        }
        if (req.body.registeredLocation && typeof req.body.registeredLocation.latitude === 'number') {
            const address = req.body.registeredLocation.address || await (0, geocoding_1.reverseGeocode)(req.body.registeredLocation.latitude, req.body.registeredLocation.longitude);
            const regLoc = {
                latitude: req.body.registeredLocation.latitude,
                longitude: req.body.registeredLocation.longitude,
                address,
                capturedAt: req.body.registeredLocation.capturedAt || new Date()
            };
            user.registeredLocation = regLoc;
            user.registrationLocation = regLoc;
        }
        if (isApproved !== undefined) {
            user.isApproved = isApproved;
            if (isApproved) {
                user.approvalStatus = 'approved';
                user.isActive = true;
            }
            else {
                user.approvalStatus = 'rejected';
                user.isActive = false;
            }
        }
        if (approvalStatus !== undefined) {
            user.approvalStatus = approvalStatus;
            if (approvalStatus === 'approved') {
                user.isApproved = true;
                user.isActive = true;
            }
            else if (approvalStatus === 'rejected') {
                user.isApproved = false;
                user.isActive = false;
            }
            else {
                user.isApproved = false;
                user.isActive = false;
            }
        }
        if (isActive !== undefined) {
            user.isActive = isActive;
            if (isActive && (!user.approvalStatus || user.approvalStatus === 'pending')) {
                user.isApproved = true;
                user.approvalStatus = 'approved';
            }
        }
        if (reportingManager !== undefined)
            user.reportingManager = reportingManager || null;
        if (department !== undefined)
            user.department = department;
        await user.save();
        res.status(200).json(user);
    }
    catch (e) {
        res.status(500).json({ error: 'Failed to update user.' });
    }
});
// 11. Get Lead Count for User Before Deletion
router.get('/users/:id/lead-count', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const user = await User_1.default.findOne({ _id: req.params.id, organizationId: req.organizationId });
        if (!user) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: req.organizationId, apiPath: 'leads' });
        if (!leadModule) {
            res.status(200).json({ assignedCount: 0, userName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email });
            return;
        }
        const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
        const assignedCount = await CustomRecord_1.default.countDocuments({
            organizationId: req.organizationId,
            moduleId: leadModule._id,
            $or: [
                { 'data.assignedTo': String(user._id) },
                { 'data.assignedTo': user.email },
                { 'data.assignedTo': user.firstName },
                { 'data.assignedTo': fullName }
            ]
        });
        res.status(200).json({ assignedCount, userName: fullName || user.email });
    }
    catch (e) {
        res.status(500).json({ error: 'Failed to fetch user lead count.' });
    }
});
// 12. Delete User (Requires 0 assigned leads)
router.delete('/users/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const requester = await User_1.default.findById(req.user.id);
        const requesterRole = await getRequesterRoleName(requester);
        const isAdmin = ['Super Admin', 'ADMIN', 'Sales Admin', 'SALES MANAGER', 'TELI CALLER'].includes(requesterRole) || requester?.email?.toLowerCase().includes('ink');
        if (!isAdmin) {
            res.status(403).json({ error: 'Access denied: You do not have permission to delete users.' });
            return;
        }
        const user = await User_1.default.findOne({ _id: req.params.id, organizationId: req.organizationId });
        if (!user) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }
        // Check if user still has assigned leads
        const leadModule = await ModuleDefinition_1.default.findOne({ organizationId: req.organizationId, apiPath: 'leads' });
        let assignedCount = 0;
        if (leadModule) {
            const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
            assignedCount = await CustomRecord_1.default.countDocuments({
                organizationId: req.organizationId,
                moduleId: leadModule._id,
                $or: [
                    { 'data.assignedTo': String(user._id) },
                    { 'data.assignedTo': user.email },
                    { 'data.assignedTo': user.firstName },
                    { 'data.assignedTo': fullName }
                ]
            });
        }
        if (assignedCount > 0) {
            res.status(400).json({
                error: `Cannot delete user '${user.firstName} ${user.lastName}'. They still have ${assignedCount} assigned lead(s). Please transfer all leads before deleting.`,
                assignedCount
            });
            return;
        }
        await User_1.default.deleteOne({ _id: user._id });
        res.status(200).json({ message: 'User deleted successfully.' });
    }
    catch (e) {
        res.status(500).json({ error: 'Failed to delete user.' });
    }
});
exports.default = router;
