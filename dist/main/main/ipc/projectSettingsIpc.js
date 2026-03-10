"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProjectSettingsIpc = registerProjectSettingsIpc;
const electron_1 = require("electron");
const logger_1 = require("../lib/logger");
const ProjectSettingsService_1 = require("../services/ProjectSettingsService");
const WorktreeService_1 = require("../services/WorktreeService");
const resolveProjectId = (input) => {
    if (!input)
        return '';
    if (typeof input === 'string')
        return input;
    return input.projectId;
};
function registerProjectSettingsIpc() {
    electron_1.ipcMain.handle('projectSettings:get', async (_event, args) => {
        try {
            const projectId = resolveProjectId(args);
            if (!projectId) {
                throw new Error('projectId is required');
            }
            const settings = await ProjectSettingsService_1.projectSettingsService.getProjectSettings(projectId);
            if (!settings) {
                return { success: false, error: 'Project not found' };
            }
            return { success: true, settings };
        }
        catch (error) {
            logger_1.log.error('Failed to get project settings', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('projectSettings:update', async (_event, args) => {
        try {
            const projectId = args?.projectId;
            const baseRef = args?.baseRef;
            if (!projectId) {
                throw new Error('projectId is required');
            }
            if (typeof baseRef !== 'string') {
                throw new Error('baseRef is required');
            }
            const trimmed = baseRef.trim();
            if (!trimmed) {
                throw new Error('baseRef cannot be empty');
            }
            const settings = await ProjectSettingsService_1.projectSettingsService.updateProjectSettings(projectId, {
                baseRef: trimmed,
            });
            return { success: true, settings };
        }
        catch (error) {
            logger_1.log.error('Failed to update project settings', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('projectSettings:fetchBaseRef', async (_event, args) => {
        try {
            const projectId = args?.projectId;
            const projectPath = args?.projectPath;
            if (!projectId) {
                throw new Error('projectId is required');
            }
            if (!projectPath) {
                throw new Error('projectPath is required');
            }
            const info = await WorktreeService_1.worktreeService.fetchLatestBaseRef(projectPath, projectId);
            return {
                success: true,
                baseRef: info.fullRef,
                remote: info.remote,
                branch: info.branch,
            };
        }
        catch (error) {
            logger_1.log.error('Failed to fetch base branch', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
}
