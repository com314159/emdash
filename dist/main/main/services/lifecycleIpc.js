"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLifecycleIpc = registerLifecycleIpc;
const electron_1 = require("electron");
const LifecycleScriptsService_1 = require("./LifecycleScriptsService");
const logger_1 = require("../lib/logger");
const lifecycle_1 = require("@shared/lifecycle");
const TaskLifecycleService_1 = require("./TaskLifecycleService");
function registerLifecycleIpc() {
    // Get a specific lifecycle phase script for a project
    electron_1.ipcMain.handle('lifecycle:getScript', async (_event, args) => {
        try {
            if (!lifecycle_1.LIFECYCLE_PHASES.includes(args.phase)) {
                return { success: false, error: `Invalid lifecycle phase: ${args.phase}` };
            }
            const phase = args.phase;
            const script = LifecycleScriptsService_1.lifecycleScriptsService.getScript(args.projectPath, phase);
            return { success: true, script };
        }
        catch (error) {
            logger_1.log.error('Failed to get lifecycle script:', error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('lifecycle:setup', async (_event, args) => {
        try {
            const result = await TaskLifecycleService_1.taskLifecycleService.runSetup(args.taskId, args.taskPath, args.projectPath, args.taskName);
            return { success: result.ok, ...result };
        }
        catch (error) {
            logger_1.log.error('Failed to run setup lifecycle phase:', error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('lifecycle:run:start', async (_event, args) => {
        try {
            const result = await TaskLifecycleService_1.taskLifecycleService.startRun(args.taskId, args.taskPath, args.projectPath, args.taskName);
            return { success: result.ok, ...result };
        }
        catch (error) {
            logger_1.log.error('Failed to start run lifecycle phase:', error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('lifecycle:run:stop', async (_event, args) => {
        try {
            const result = TaskLifecycleService_1.taskLifecycleService.stopRun(args.taskId);
            return { success: result.ok, ...result };
        }
        catch (error) {
            logger_1.log.error('Failed to stop run lifecycle phase:', error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('lifecycle:teardown', async (_event, args) => {
        try {
            const result = await TaskLifecycleService_1.taskLifecycleService.runTeardown(args.taskId, args.taskPath, args.projectPath, args.taskName);
            return { success: result.ok, ...result };
        }
        catch (error) {
            logger_1.log.error('Failed to run teardown lifecycle phase:', error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('lifecycle:getState', async (_event, args) => {
        try {
            const state = TaskLifecycleService_1.taskLifecycleService.getState(args.taskId);
            return { success: true, state };
        }
        catch (error) {
            logger_1.log.error('Failed to get lifecycle state:', error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('lifecycle:getLogs', async (_event, args) => {
        try {
            const logs = TaskLifecycleService_1.taskLifecycleService.getLogs(args.taskId);
            return { success: true, logs };
        }
        catch (error) {
            logger_1.log.error('Failed to get lifecycle logs:', error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('lifecycle:clearTask', async (_event, args) => {
        try {
            TaskLifecycleService_1.taskLifecycleService.clearTask(args.taskId);
            return { success: true };
        }
        catch (error) {
            logger_1.log.error('Failed to clear lifecycle state for task:', error);
            return { success: false, error: error.message };
        }
    });
    const forward = (evt) => {
        const all = electron_1.BrowserWindow.getAllWindows();
        for (const win of all) {
            try {
                win.webContents.send(lifecycle_1.LIFECYCLE_EVENT_CHANNEL, evt);
            }
            catch { }
        }
    };
    TaskLifecycleService_1.taskLifecycleService.onEvent(forward);
}
