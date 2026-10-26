"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../config/db");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const User_1 = __importDefault(require("../models/User"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
async function main() {
    await (0, db_1.connectDB)();
    // Set all existing users to approved
    const res = await User_1.default.updateMany({}, {
        $set: {
            isApproved: true,
            approvalStatus: 'approved',
            isActive: true
        }
    });
    console.log('Updated existing users to approved:', res.modifiedCount);
    const users = await User_1.default.find().select('firstName lastName email isApproved approvalStatus isActive');
    console.log(users);
    await (0, db_1.disconnectDB)();
}
main().catch(console.error);
