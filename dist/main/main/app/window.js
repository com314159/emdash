"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMainWindow = createMainWindow;
exports.getMainWindow = getMainWindow;
const electron_1 = require("electron");
const path_1 = require("path");
const dev_1 = require("../utils/dev");
const externalLinks_1 = require("../utils/externalLinks");
const staticServer_1 = require("./staticServer");
let mainWindow = null;
function createMainWindow() {
    // In development, resolve icon from src/assets
    // In production (packaged), electron-builder handles the icon
    const iconPath = dev_1.isDev
        ? (0, path_1.join)(__dirname, '..', '..', '..', 'src', 'assets', 'images', 'emdash', 'emdash_logo.png')
        : undefined;
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 700,
        minHeight: 500,
        title: 'Emdash',
        ...(iconPath && { icon: iconPath }),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // Allow using <webview> in renderer for in‑app browser pane.
            // The webview runs in a separate process; nodeIntegration remains disabled.
            webviewTag: true,
            // __dirname here resolves to dist/main/main/app at runtime (dev)
            // Preload is emitted to dist/main/main/preload.js
            preload: (0, path_1.join)(__dirname, '..', 'preload.js'),
        },
        ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
        show: false,
    });
    if (dev_1.isDev) {
        mainWindow.loadURL('http://localhost:3000');
    }
    else {
        // Serve renderer over an HTTP origin in production so embeds work.
        const rendererRoot = (0, path_1.join)(electron_1.app.getAppPath(), 'dist', 'renderer');
        void (0, staticServer_1.ensureRendererServer)(rendererRoot)
            .then((url) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.loadURL(url);
            }
        })
            .catch(() => {
            // Fallback to file load if server fails for any reason.
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.loadFile((0, path_1.join)(rendererRoot, 'index.html'));
            }
        });
    }
    // Route external links to the user’s default browser
    (0, externalLinks_1.registerExternalLinkHandlers)(mainWindow, dev_1.isDev);
    // Show when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });
    // Track window focus for telemetry
    mainWindow.on('focus', () => {
        // Lazy import to avoid circular dependencies
        void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture, checkAndReportDailyActiveUser }) => {
            void capture('app_window_focused');
            // Also check for daily active user when window gains focus
            checkAndReportDailyActiveUser();
        });
    });
    // Cleanup reference on close
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    return mainWindow;
}
function getMainWindow() {
    return mainWindow;
}
