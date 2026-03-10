"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerJiraIpc = registerJiraIpc;
const electron_1 = require("electron");
const JiraService_1 = __importDefault(require("../services/JiraService"));
const jira = new JiraService_1.default();
function registerJiraIpc() {
    electron_1.ipcMain.handle('jira:saveCredentials', async (_e, args) => {
        const siteUrl = String(args?.siteUrl || '').trim();
        const email = String(args?.email || '').trim();
        const token = String(args?.token || '').trim();
        if (!siteUrl || !email || !token) {
            return { success: false, error: 'Site URL, email, and API token are required.' };
        }
        return jira.saveCredentials(siteUrl, email, token);
    });
    electron_1.ipcMain.handle('jira:clearCredentials', async () => jira.clearCredentials());
    electron_1.ipcMain.handle('jira:checkConnection', async () => jira.checkConnection());
    electron_1.ipcMain.handle('jira:initialFetch', async (_e, limit) => {
        try {
            const issues = await jira.initialFetch(typeof limit === 'number' && Number.isFinite(limit) ? limit : 50);
            return { success: true, issues };
        }
        catch (e) {
            return { success: false, error: e?.message || String(e) };
        }
    });
    electron_1.ipcMain.handle('jira:searchIssues', async (_e, searchTerm, limit) => {
        try {
            // Use enhanced search that supports direct key lookups
            const issues = await jira.smartSearchIssues(searchTerm, limit ?? 20);
            return { success: true, issues };
        }
        catch (e) {
            return { success: false, error: e?.message || String(e) };
        }
    });
}
exports.default = registerJiraIpc;
