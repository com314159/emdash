"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAppLifecycle = registerAppLifecycle;
const electron_1 = require("electron");
const window_1 = require("./window");
function registerAppLifecycle() {
    electron_1.app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            electron_1.app.quit();
        }
    });
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            (0, window_1.createMainWindow)();
        }
    });
}
