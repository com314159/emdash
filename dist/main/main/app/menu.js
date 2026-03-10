"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupApplicationMenu = setupApplicationMenu;
const electron_1 = require("electron");
const urls_1 = require("@shared/urls");
function getFocusedWindow() {
    return electron_1.BrowserWindow.getFocusedWindow() ?? electron_1.BrowserWindow.getAllWindows()[0] ?? null;
}
function sendToRenderer(channel) {
    const win = getFocusedWindow();
    if (win)
        win.webContents.send(channel);
}
function setupApplicationMenu() {
    const isMac = process.platform === 'darwin';
    const template = [
        // macOS app menu
        ...(isMac
            ? [
                {
                    label: electron_1.app.name,
                    submenu: [
                        {
                            label: `About ${electron_1.app.name}`,
                            click: () => electron_1.app.showAboutPanel(),
                        },
                        { type: 'separator' },
                        {
                            label: 'Settings\u2026',
                            accelerator: 'CmdOrCtrl+,',
                            click: () => sendToRenderer('menu:open-settings'),
                        },
                        {
                            label: 'Check for Updates\u2026',
                            click: () => sendToRenderer('menu:check-for-updates'),
                        },
                        { type: 'separator' },
                        { role: 'services' },
                        { type: 'separator' },
                        { role: 'hide' },
                        { role: 'hideOthers' },
                        { role: 'unhide' },
                        { type: 'separator' },
                        {
                            label: `Quit ${electron_1.app.name}`,
                            accelerator: 'CmdOrCtrl+Q',
                            click: () => electron_1.app.quit(),
                        },
                    ],
                },
            ]
            : []),
        // File menu
        {
            label: 'File',
            submenu: [
                // On non-macOS, put Settings in File menu
                ...(!isMac
                    ? [
                        {
                            label: 'Settings\u2026',
                            accelerator: 'CmdOrCtrl+,',
                            click: () => sendToRenderer('menu:open-settings'),
                        },
                        { type: 'separator' },
                    ]
                    : []),
                {
                    label: 'Close Tab',
                    accelerator: 'CmdOrCtrl+W',
                    click: () => sendToRenderer('menu:close-tab'),
                },
                ...(!isMac ? [{ type: 'separator' }, { role: 'quit' }] : []),
            ],
        },
        // Edit menu
        {
            label: 'Edit',
            submenu: [
                {
                    label: 'Undo',
                    accelerator: 'CmdOrCtrl+Z',
                    click: () => sendToRenderer('menu:undo'),
                },
                {
                    label: 'Redo',
                    accelerator: isMac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y',
                    click: () => sendToRenderer('menu:redo'),
                },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                ...(isMac ? [{ role: 'pasteAndMatchStyle' }] : []),
                { role: 'delete' },
                { role: 'selectAll' },
            ],
        },
        // View menu
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        // Window menu
        { role: 'windowMenu' },
        // Help menu
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Docs',
                    click: () => electron_1.shell.openExternal(urls_1.EMDASH_DOCS_URL),
                },
                {
                    label: 'Changelog',
                    click: () => electron_1.shell.openExternal(urls_1.EMDASH_RELEASES_URL),
                },
                ...(!isMac
                    ? [
                        { type: 'separator' },
                        {
                            label: 'Check for Updates\u2026',
                            click: () => sendToRenderer('menu:check-for-updates'),
                        },
                    ]
                    : []),
            ],
        },
    ];
    const menu = electron_1.Menu.buildFromTemplate(template);
    electron_1.Menu.setApplicationMenu(menu);
}
