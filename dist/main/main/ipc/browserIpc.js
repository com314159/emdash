"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerBrowserIpc = registerBrowserIpc;
const electron_1 = require("electron");
const browserViewService_1 = require("../services/browserViewService");
function registerBrowserIpc() {
    electron_1.ipcMain.handle('browser:view:show', (_e, args) => {
        const { x, y, width, height, url } = args || {};
        browserViewService_1.browserViewService.show({ x, y, width, height }, url);
        return { ok: true };
    });
    electron_1.ipcMain.handle('browser:view:hide', () => {
        browserViewService_1.browserViewService.hide();
        return { ok: true };
    });
    electron_1.ipcMain.handle('browser:view:setBounds', (_e, args) => {
        const { x, y, width, height } = args || {};
        browserViewService_1.browserViewService.setBounds({ x, y, width, height });
        return { ok: true };
    });
    electron_1.ipcMain.handle('browser:view:loadURL', (_e, url, forceReload) => {
        browserViewService_1.browserViewService.loadURL(url, forceReload);
        return { ok: true };
    });
    electron_1.ipcMain.handle('browser:view:goBack', () => {
        browserViewService_1.browserViewService.goBack();
        return { ok: true };
    });
    electron_1.ipcMain.handle('browser:view:goForward', () => {
        browserViewService_1.browserViewService.goForward();
        return { ok: true };
    });
    electron_1.ipcMain.handle('browser:view:reload', () => {
        browserViewService_1.browserViewService.reload();
        return { ok: true };
    });
    electron_1.ipcMain.handle('browser:view:openDevTools', () => {
        browserViewService_1.browserViewService.openDevTools();
        return { ok: true };
    });
    electron_1.ipcMain.handle('browser:view:clear', () => {
        browserViewService_1.browserViewService.clear();
        return { ok: true };
    });
}
