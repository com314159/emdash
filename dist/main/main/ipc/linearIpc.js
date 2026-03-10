"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLinearIpc = registerLinearIpc;
const electron_1 = require("electron");
const LinearService_1 = __importDefault(require("../services/LinearService"));
const linearService = new LinearService_1.default();
function registerLinearIpc() {
    electron_1.ipcMain.handle('linear:saveToken', async (_event, token) => {
        if (!token || typeof token !== 'string') {
            return { success: false, error: 'A Linear API token is required.' };
        }
        return linearService.saveToken(token);
    });
    electron_1.ipcMain.handle('linear:checkConnection', async () => {
        return linearService.checkConnection();
    });
    electron_1.ipcMain.handle('linear:clearToken', async () => {
        return linearService.clearToken();
    });
    electron_1.ipcMain.handle('linear:initialFetch', async (_event, limit) => {
        try {
            const issues = await linearService.initialFetch(typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined);
            return { success: true, issues };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to fetch initial Linear issues right now.';
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('linear:searchIssues', async (_event, searchTerm, limit) => {
        if (!searchTerm || typeof searchTerm !== 'string') {
            return { success: false, error: 'Search term is required.' };
        }
        try {
            const issues = await linearService.searchIssues(searchTerm, limit ?? 20);
            return { success: true, issues };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to search Linear issues right now.';
            return { success: false, error: message };
        }
    });
}
exports.default = registerLinearIpc;
