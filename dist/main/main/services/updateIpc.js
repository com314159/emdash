"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUpdateIpc = registerUpdateIpc;
const electron_1 = require("electron");
const updaterError_1 = require("../lib/updaterError");
const AutoUpdateService_1 = require("./AutoUpdateService");
const DEV_HINT_CHECK = 'Updates are disabled in development.';
const DEV_HINT_DOWNLOAD = 'Cannot download updates in development.';
// Skip all auto-updater setup in development
const isDev = !electron_1.app.isPackaged || process.env.NODE_ENV === 'development';
// Fallback: open latest download link in browser for manual install
function getLatestDownloadUrl() {
    const platform = process.platform;
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const baseUrl = 'https://github.com/generalaction/emdash/releases/latest/download';
    switch (platform) {
        case 'darwin':
            return `${baseUrl}/emdash-${arch}.dmg`;
        case 'linux':
            // For Linux, prefer AppImage (more universal)
            return `${baseUrl}/emdash-x86_64.AppImage`;
        case 'win32':
            // For Windows, prefer the installer exe (NSIS)
            return `${baseUrl}/emdash-x64.exe`;
        default:
            // Fallback to releases page
            return 'https://github.com/generalaction/emdash/releases/latest';
    }
}
function registerUpdateIpc() {
    // AutoUpdateService handles all initialization and event listeners
    electron_1.ipcMain.handle('update:check', async () => {
        try {
            // Always skip in dev mode - no exceptions
            if (isDev) {
                return {
                    success: false,
                    error: DEV_HINT_CHECK,
                    devDisabled: true,
                };
            }
            // Delegate to AutoUpdateService to avoid race conditions
            const result = await AutoUpdateService_1.autoUpdateService.checkForUpdates(false);
            return { success: true, result: result ?? null };
        }
        catch (error) {
            return { success: false, error: (0, updaterError_1.formatUpdaterError)(error) };
        }
    });
    electron_1.ipcMain.handle('update:download', async () => {
        try {
            // Always skip in dev mode - no exceptions
            if (isDev) {
                return {
                    success: false,
                    error: DEV_HINT_DOWNLOAD,
                    devDisabled: true,
                };
            }
            // Delegate to AutoUpdateService to avoid race conditions
            await AutoUpdateService_1.autoUpdateService.downloadUpdate();
            return { success: true };
        }
        catch (error) {
            return { success: false, error: (0, updaterError_1.formatUpdaterError)(error) };
        }
    });
    electron_1.ipcMain.handle('update:quit-and-install', async () => {
        try {
            // Delegate to AutoUpdateService which handles rollback info
            AutoUpdateService_1.autoUpdateService.quitAndInstall();
            return { success: true };
        }
        catch (error) {
            return { success: false, error: (0, updaterError_1.formatUpdaterError)(error) };
        }
    });
    electron_1.ipcMain.handle('update:open-latest', async () => {
        try {
            const { shell } = require('electron');
            await shell.openExternal(getLatestDownloadUrl());
            // Gracefully quit after opening the external download link so the user can install
            setTimeout(() => {
                try {
                    electron_1.app.quit();
                }
                catch { }
            }, 500);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    // Expose app version for simple comparisons on renderer
    electron_1.ipcMain.handle('update:get-version', () => electron_1.app.getVersion());
    // Enhanced IPC handlers for AutoUpdateService
    electron_1.ipcMain.handle('update:get-state', async () => {
        try {
            const state = AutoUpdateService_1.autoUpdateService.getState();
            return { success: true, data: state };
        }
        catch (error) {
            return { success: false, error: (0, updaterError_1.formatUpdaterError)(error) };
        }
    });
    electron_1.ipcMain.handle('update:get-settings', async () => {
        try {
            const settings = AutoUpdateService_1.autoUpdateService.getSettings();
            return { success: true, data: settings };
        }
        catch (error) {
            return { success: false, error: (0, updaterError_1.formatUpdaterError)(error) };
        }
    });
    electron_1.ipcMain.handle('update:update-settings', async (_event, settings) => {
        try {
            await AutoUpdateService_1.autoUpdateService.updateSettings(settings);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: (0, updaterError_1.formatUpdaterError)(error) };
        }
    });
    electron_1.ipcMain.handle('update:get-release-notes', async () => {
        try {
            const notes = await AutoUpdateService_1.autoUpdateService.fetchReleaseNotes();
            return { success: true, data: notes };
        }
        catch (error) {
            return { success: false, error: (0, updaterError_1.formatUpdaterError)(error) };
        }
    });
    electron_1.ipcMain.handle('update:check-now', async () => {
        try {
            const result = await AutoUpdateService_1.autoUpdateService.checkForUpdates(false);
            return { success: true, data: result };
        }
        catch (error) {
            return { success: false, error: (0, updaterError_1.formatUpdaterError)(error) };
        }
    });
}
