"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPlainIpc = registerPlainIpc;
const electron_1 = require("electron");
const PlainService_1 = __importDefault(require("../services/PlainService"));
const plainService = new PlainService_1.default();
function registerPlainIpc() {
    electron_1.ipcMain.handle('plain:saveToken', async (_event, token) => {
        if (!token || typeof token !== 'string') {
            return { success: false, error: 'A Plain API token is required.' };
        }
        return plainService.saveToken(token);
    });
    electron_1.ipcMain.handle('plain:checkConnection', async () => {
        return plainService.checkConnection();
    });
    electron_1.ipcMain.handle('plain:clearToken', async () => {
        return plainService.clearToken();
    });
    electron_1.ipcMain.handle('plain:initialFetch', async (_event, limit, statuses) => {
        try {
            const sanitizedStatuses = Array.isArray(statuses)
                ? statuses.filter((s) => ['TODO', 'DONE', 'SNOOZED'].includes(s))
                : undefined;
            const threads = await plainService.initialFetch(typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined, sanitizedStatuses && sanitizedStatuses.length > 0 ? sanitizedStatuses : undefined);
            return { success: true, threads };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to fetch Plain threads right now.';
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('plain:searchThreads', async (_event, searchTerm, limit) => {
        if (!searchTerm || typeof searchTerm !== 'string') {
            return { success: false, error: 'Search term is required.' };
        }
        try {
            const threads = await plainService.searchThreads(searchTerm, limit ?? 20);
            return { success: true, threads };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to search Plain threads right now.';
            return { success: false, error: message };
        }
    });
}
exports.default = registerPlainIpc;
