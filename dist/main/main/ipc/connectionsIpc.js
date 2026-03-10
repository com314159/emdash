"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerConnectionsIpc = registerConnectionsIpc;
const electron_1 = require("electron");
const ConnectionsService_1 = require("../services/ConnectionsService");
const settings_1 = require("../settings");
function registerConnectionsIpc() {
    electron_1.ipcMain.handle('providers:getStatuses', async (_event, opts) => {
        const providers = Array.isArray(opts?.providers) && opts.providers.length > 0
            ? opts.providers
            : opts?.providerId
                ? [opts.providerId]
                : null;
        try {
            if (opts?.refresh) {
                if (providers && providers.length > 0) {
                    for (const id of providers) {
                        await ConnectionsService_1.connectionsService.checkProvider(id, 'manual');
                    }
                }
                else {
                    await ConnectionsService_1.connectionsService.refreshAllProviderStatuses();
                }
            }
            const statuses = ConnectionsService_1.connectionsService.getCachedProviderStatuses();
            return { success: true, statuses };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });
    // Get custom config for a specific provider
    electron_1.ipcMain.handle('providers:getCustomConfig', (_event, providerId) => {
        try {
            const config = (0, settings_1.getProviderCustomConfig)(providerId);
            return { success: true, config };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });
    // Get all custom configs
    electron_1.ipcMain.handle('providers:getAllCustomConfigs', () => {
        try {
            const configs = (0, settings_1.getAllProviderCustomConfigs)();
            return { success: true, configs };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });
    // Update custom config for a specific provider
    electron_1.ipcMain.handle('providers:updateCustomConfig', (_event, providerId, config) => {
        try {
            (0, settings_1.updateProviderCustomConfig)(providerId, config);
            return { success: true };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });
}
