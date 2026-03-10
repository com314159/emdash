"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGitlabIpc = registerGitlabIpc;
const electron_1 = require("electron");
const GitLabService_1 = require("../services/GitLabService");
const logger_1 = require("../lib/logger");
function registerGitlabIpc() {
    electron_1.ipcMain.handle('gitlab:saveCredentials', async (_e, args) => {
        const instanceUrl = String(args?.instanceUrl || '').trim();
        const token = String(args?.token || '').trim();
        if (!instanceUrl || !token) {
            return { success: false, error: 'Instance URL and API token are required.' };
        }
        try {
            return await GitLabService_1.gitlabService.saveCredentials(instanceUrl, token);
        }
        catch (error) {
            logger_1.log.error('GitLab saveCredentials failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to save GitLab credentials',
            };
        }
    });
    electron_1.ipcMain.handle('gitlab:clearCredentials', async () => {
        try {
            return await GitLabService_1.gitlabService.clearCredentials();
        }
        catch (error) {
            logger_1.log.error('GitLab clearCredentials failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to clear GitLab credentials',
            };
        }
    });
    electron_1.ipcMain.handle('gitlab:checkConnection', async () => {
        try {
            return await GitLabService_1.gitlabService.checkConnection();
        }
        catch (error) {
            logger_1.log.error('GitLab checkConnection failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to check GitLab connection',
            };
        }
    });
    electron_1.ipcMain.handle('gitlab:initialFetch', async (_e, args) => {
        const projectPath = args?.projectPath;
        const limit = typeof args?.limit === 'number' && Number.isFinite(args.limit)
            ? Math.max(1, Math.min(args.limit, 100))
            : 50;
        try {
            return await GitLabService_1.gitlabService.initialFetch(projectPath, limit);
        }
        catch (error) {
            logger_1.log.error('GitLab initialFetch failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch GitLab issues',
            };
        }
    });
    electron_1.ipcMain.handle('gitlab:searchIssues', async (_e, args) => {
        const searchTerm = String(args?.searchTerm || '').trim();
        if (!searchTerm) {
            return { success: true, issues: [] };
        }
        const projectPath = args?.projectPath;
        const limit = typeof args?.limit === 'number' && Number.isFinite(args.limit)
            ? Math.max(1, Math.min(args.limit, 100))
            : 20;
        try {
            return await GitLabService_1.gitlabService.searchIssues(projectPath, searchTerm, limit);
        }
        catch (error) {
            logger_1.log.error('GitLab searchIssues failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to search GitLab issues',
            };
        }
    });
}
exports.default = registerGitlabIpc;
