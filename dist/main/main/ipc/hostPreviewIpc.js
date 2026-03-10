"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHostPreviewIpc = registerHostPreviewIpc;
const electron_1 = require("electron");
const hostPreviewService_1 = require("../services/hostPreviewService");
function registerHostPreviewIpc() {
    electron_1.ipcMain.handle('preview:host:start', async (_e, args) => {
        const id = String(args?.taskId || '').trim();
        const wp = String(args?.taskPath || '').trim();
        if (!id || !wp)
            return { ok: false, error: 'taskId and taskPath are required' };
        return hostPreviewService_1.hostPreviewService.start(id, wp, {
            script: args?.script,
            parentProjectPath: args?.parentProjectPath,
        });
    });
    electron_1.ipcMain.handle('preview:host:setup', async (_e, args) => {
        const id = String(args?.taskId || '').trim();
        const wp = String(args?.taskPath || '').trim();
        if (!id || !wp)
            return { ok: false, error: 'taskId and taskPath are required' };
        return hostPreviewService_1.hostPreviewService.setup(id, wp);
    });
    electron_1.ipcMain.handle('preview:host:stop', async (_e, id) => {
        const wid = String(id || '').trim();
        if (!wid)
            return { ok: true };
        return hostPreviewService_1.hostPreviewService.stop(wid);
    });
    electron_1.ipcMain.handle('preview:host:stopAll', async (_e, exceptId) => {
        const ex = typeof exceptId === 'string' ? exceptId : '';
        return hostPreviewService_1.hostPreviewService.stopAll(ex);
    });
    const forward = (evt) => {
        const all = electron_1.BrowserWindow.getAllWindows();
        for (const win of all) {
            try {
                win.webContents.send('preview:host:event', evt);
            }
            catch { }
        }
    };
    hostPreviewService_1.hostPreviewService.onEvent(forward);
}
