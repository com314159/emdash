"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMcpIpc = registerMcpIpc;
const electron_1 = require("electron");
const McpService_1 = require("../services/McpService");
const configPaths_1 = require("../services/mcp/configPaths");
const logger_1 = require("../lib/logger");
const registry_1 = require("@shared/providers/registry");
const providerStatusCache_1 = require("../services/providerStatusCache");
const ConnectionsService_1 = require("../services/ConnectionsService");
function mapProviders(agentIds) {
    const statuses = providerStatusCache_1.providerStatusCache.getAll();
    return agentIds.map((id) => {
        const provider = registry_1.PROVIDERS.find((p) => p.id === id);
        return {
            id,
            name: provider?.name ?? id,
            installed: statuses[id]?.installed ?? false,
            supportsHttp: (0, configPaths_1.agentSupportsHttp)(id),
        };
    });
}
function registerMcpIpc() {
    electron_1.ipcMain.handle('mcp:load-all', async () => {
        try {
            const data = await McpService_1.mcpService.loadAll();
            return { success: true, data };
        }
        catch (error) {
            logger_1.log.error('Failed to load MCP servers:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('mcp:save-server', async (_event, server) => {
        try {
            await McpService_1.mcpService.saveServer(server);
            return { success: true };
        }
        catch (error) {
            logger_1.log.error('Failed to save MCP server:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('mcp:remove-server', async (_event, serverName) => {
        try {
            await McpService_1.mcpService.removeServer(serverName);
            return { success: true };
        }
        catch (error) {
            logger_1.log.error('Failed to remove MCP server:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('mcp:get-providers', async () => {
        try {
            return { success: true, data: mapProviders((0, configPaths_1.getAllMcpAgentIds)()) };
        }
        catch (error) {
            logger_1.log.error('Failed to get MCP providers:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('mcp:refresh-providers', async () => {
        try {
            await ConnectionsService_1.connectionsService.refreshAllProviderStatuses();
            return { success: true, data: mapProviders((0, configPaths_1.getAllMcpAgentIds)()) };
        }
        catch (error) {
            logger_1.log.error('Failed to refresh MCP providers:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
}
