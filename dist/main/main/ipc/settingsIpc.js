"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appSettingsController = void 0;
const settings_1 = require("../settings");
const rpc_1 = require("../../shared/ipc/rpc");
exports.appSettingsController = (0, rpc_1.createRPCController)({
    get: async () => (0, settings_1.getAppSettings)(),
    update: (partial) => (0, settings_1.updateAppSettings)(partial || {}),
});
