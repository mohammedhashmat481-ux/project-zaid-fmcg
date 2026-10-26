"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.disconnectDB = exports.connectDB = void 0;
const postgres_1 = require("./postgres");
const connectDB = async () => {
    await (0, postgres_1.connectPostgres)();
};
exports.connectDB = connectDB;
const disconnectDB = async () => {
    await (0, postgres_1.disconnectPostgres)();
};
exports.disconnectDB = disconnectDB;
