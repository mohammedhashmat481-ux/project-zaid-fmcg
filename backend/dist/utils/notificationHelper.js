"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotification = void 0;
const Notification_1 = __importDefault(require("../models/Notification"));
const User_1 = __importDefault(require("../models/User"));
const PgModel_1 = require("../models/PgModel");
/**
 * Creates a notification for a recipient identified by User ID, Email, or Full Name.
 */
const createNotification = async ({ organizationId, recipient, title, message, type = 'info', link }) => {
    try {
        if (!recipient || !organizationId)
            return null;
        let targetUserId = null;
        if (PgModel_1.PgObjectId.isValid(String(recipient))) {
            const existingUser = await User_1.default.findOne({
                _id: String(recipient),
                organizationId
            });
            if (existingUser) {
                targetUserId = String(existingUser._id);
            }
        }
        if (!targetUserId) {
            // Look up user by full name or email
            const searchStr = String(recipient).trim().toLowerCase();
            const parts = searchStr.split(/\s+/);
            const user = await User_1.default.findOne({
                organizationId,
                $or: [
                    { email: searchStr },
                    { firstName: new RegExp(`^${searchStr}$`, 'i') },
                    { lastName: new RegExp(`^${searchStr}$`, 'i') },
                    ...(parts.length > 1
                        ? [
                            {
                                $and: [
                                    { firstName: new RegExp(`^${parts[0]}$`, 'i') },
                                    { lastName: new RegExp(`^${parts.slice(1).join(' ')}$`, 'i') }
                                ]
                            }
                        ]
                        : [])
                ]
            });
            if (user) {
                targetUserId = String(user._id);
            }
        }
        if (!targetUserId) {
            return null;
        }
        const notification = await Notification_1.default.create({
            organizationId,
            userId: targetUserId,
            title,
            message,
            type,
            isRead: false,
            link
        });
        return notification;
    }
    catch (error) {
        console.error('Failed to create notification:', error);
        return null;
    }
};
exports.createNotification = createNotification;
