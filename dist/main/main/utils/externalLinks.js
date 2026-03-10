"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerExternalLinkHandlers = registerExternalLinkHandlers;
const electron_1 = require("electron");
/**
 * Ensure any external HTTP(S) links open in the user’s default browser
 * rather than inside the Electron window. Keeps app navigation scoped
 * to our renderer while preserving expected link behavior.
 */
function registerExternalLinkHandlers(win, isDev) {
    const wc = win.webContents;
    const isInternalAppUrl = (url) => {
        if (isDev)
            return url.startsWith('http://localhost:3000');
        return url.startsWith('file://') || /^http:\/\/(127\.0\.0\.1|localhost):\d+(?:\/|$)/i.test(url);
    };
    // Handle window.open and target="_blank"
    wc.setWindowOpenHandler(({ url }) => {
        if (!isInternalAppUrl(url) && /^https?:\/\//i.test(url)) {
            electron_1.shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });
    // Intercept navigations that would leave the app
    wc.on('will-navigate', (event, url) => {
        if (!isInternalAppUrl(url) && /^https?:\/\//i.test(url)) {
            event.preventDefault();
            electron_1.shell.openExternal(url);
        }
    });
}
