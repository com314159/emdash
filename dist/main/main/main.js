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
// Load .env FIRST before any imports that might use it
// Use explicit path to ensure .env is loaded from project root
try {
    const path = require('path');
    const envPath = path.join(__dirname, '..', '..', '.env');
    require('dotenv').config({ path: envPath });
}
catch (error) {
    // dotenv is optional - no error if .env doesn't exist
}
const electron_1 = require("electron");
const shellEnv_1 = require("./utils/shellEnv");
// Ensure PATH matches the user's shell when launched from Finder (macOS)
// so Homebrew/NPM global binaries like `gh` and `codex` are found.
try {
    // Lazy import to avoid bundler complaints if not present on other platforms
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fixPath = require('fix-path');
    if (typeof fixPath === 'function')
        fixPath();
}
catch {
    // no-op if fix-path isn't available at runtime
}
if (process.platform === 'darwin') {
    const extras = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/homebrew/sbin', '/usr/local/sbin'];
    const cur = process.env.PATH || '';
    const parts = cur.split(':').filter(Boolean);
    for (const p of extras) {
        if (!parts.includes(p))
            parts.unshift(p);
    }
    process.env.PATH = parts.join(':');
    // As a last resort, ask the user's login shell for PATH and merge it in.
    try {
        const { execSync } = require('child_process');
        const shell = process.env.SHELL || '/bin/zsh';
        const loginPath = execSync(`${shell} -ilc 'echo -n $PATH'`, { encoding: 'utf8' });
        if (loginPath) {
            // Shell noise (nvm messages, ASCII art, motd) gets captured in stdout.
            // Split by both : and \n so noise fused with the first real path entry
            // (e.g. "nvm output\n/usr/local/bin") is correctly separated.
            const allEntries = (loginPath + ':' + process.env.PATH).split(/[:\n]/).filter(Boolean);
            const validEntries = allEntries.filter((p) => p.startsWith('/'));
            const merged = new Set(validEntries);
            process.env.PATH = Array.from(merged).join(':');
        }
    }
    catch { }
}
if (process.platform === 'linux') {
    try {
        const os = require('os');
        const path = require('path');
        const homeDir = os.homedir();
        const extras = [
            path.join(homeDir, '.nvm/versions/node', process.version, 'bin'),
            path.join(homeDir, '.npm-global/bin'),
            path.join(homeDir, '.local/bin'),
            '/usr/local/bin',
        ];
        const cur = process.env.PATH || '';
        const parts = cur.split(':').filter(Boolean);
        for (const p of extras) {
            if (!parts.includes(p))
                parts.unshift(p);
        }
        process.env.PATH = parts.join(':');
        try {
            const { execSync } = require('child_process');
            const shell = process.env.SHELL || '/bin/bash';
            const loginPath = execSync(`${shell} -ilc 'echo -n $PATH'`, {
                encoding: 'utf8',
            });
            if (loginPath) {
                // Shell noise (nvm messages, ASCII art, motd) gets captured in stdout.
                // Split by both : and \n so noise fused with the first real path entry
                // (e.g. "nvm output\n/usr/local/bin") is correctly separated.
                const allEntries = (loginPath + ':' + process.env.PATH).split(/[:\n]/).filter(Boolean);
                const validEntries = allEntries.filter((p) => p.startsWith('/'));
                const merged = new Set(validEntries);
                process.env.PATH = Array.from(merged).join(':');
            }
        }
        catch { }
    }
    catch { }
}
// Enable automatic Wayland/X11 detection on Linux.
// Uses native Wayland when available, falls back to X11 (XWayland) otherwise.
// Must be called before app.whenReady().
if (process.platform === 'linux') {
    electron_1.app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}
if (process.platform === 'win32') {
    // Ensure npm global binaries are in PATH for Windows
    const npmPath = require('path').join(process.env.APPDATA || '', 'npm');
    const cur = process.env.PATH || '';
    const parts = cur.split(';').filter(Boolean);
    if (npmPath && !parts.includes(npmPath)) {
        parts.unshift(npmPath);
        process.env.PATH = parts.join(';');
    }
}
// Detect SSH_AUTH_SOCK from user's shell environment
// This is necessary because GUI-launched apps don't inherit shell env vars
try {
    (0, shellEnv_1.initializeShellEnvironment)();
}
catch (error) {
    // Silent fail - SSH agent auth will fail if user tries to use it
    console.log('[main] Failed to initialize shell environment:', error);
}
const window_1 = require("./app/window");
const lifecycle_1 = require("./app/lifecycle");
const menu_1 = require("./app/menu");
const ipc_1 = require("./ipc");
const DatabaseService_1 = require("./services/DatabaseService");
const ConnectionsService_1 = require("./services/ConnectionsService");
const AutoUpdateService_1 = require("./services/AutoUpdateService");
const WorktreePoolService_1 = require("./services/WorktreePoolService");
const SshService_1 = require("./services/ssh/SshService");
const TaskLifecycleService_1 = require("./services/TaskLifecycleService");
const AgentEventService_1 = require("./services/AgentEventService");
const telemetry = __importStar(require("./telemetry"));
const errorTracking_1 = require("./errorTracking");
const path_1 = require("path");
const node_fs_1 = require("node:fs");
// Set app name for macOS dock and menu bar
electron_1.app.setName('Emdash');
// Prevent multiple instances in production (e.g. user clicks icon while auto-updater is restarting).
// Skip in dev so dev server can run alongside the packaged app.
const isDev = !electron_1.app.isPackaged || process.argv.includes('--dev');
if (!isDev) {
    const gotTheLock = electron_1.app.requestSingleInstanceLock();
    if (!gotTheLock) {
        electron_1.app.quit();
        // Must also exit the process; app.quit() alone still runs the rest of this module
        // before the event loop drains, which would register unnecessary listeners and timers.
        process.exit(0);
    }
}
electron_1.app.on('second-instance', () => {
    const win = electron_1.BrowserWindow.getAllWindows()[0];
    if (win) {
        if (win.isMinimized())
            win.restore();
        win.focus();
    }
});
// Set dock icon on macOS in development mode
if (process.platform === 'darwin' && !electron_1.app.isPackaged) {
    const iconPath = (0, path_1.join)(__dirname, '..', '..', '..', 'src', 'assets', 'images', 'emdash', 'icon-dock.png');
    try {
        electron_1.app.dock.setIcon(iconPath);
    }
    catch (err) {
        console.warn('Failed to set dock icon:', err);
    }
}
// App bootstrap
electron_1.app.whenReady().then(async () => {
    const resetLocalDatabase = async (dbPath) => {
        await DatabaseService_1.databaseService.close().catch(() => { });
        for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
            (0, node_fs_1.rmSync)(filePath, { force: true });
        }
    };
    // Initialize database
    let dbInitOk = false;
    let dbInitErrorType;
    try {
        await DatabaseService_1.databaseService.initialize();
        dbInitOk = true;
    }
    catch (error) {
        const err = error;
        const asObj = typeof err === 'object' && err !== null ? err : null;
        const code = asObj && typeof asObj.code === 'string' ? asObj.code : undefined;
        const name = asObj && typeof asObj.name === 'string' ? asObj.name : undefined;
        dbInitErrorType = code || name || 'unknown';
        console.error('Failed to initialize database:', error);
        if (err instanceof DatabaseService_1.DatabaseSchemaMismatchError) {
            const missing = err.missingInvariants.map((item) => `• ${item}`).join('\n');
            const result = await electron_1.dialog.showMessageBox({
                type: 'error',
                title: 'Local Data Reset Required',
                message: 'Emdash cannot start because your local database schema is incompatible.',
                detail: [
                    'Required schema entries are missing:',
                    missing || '• unknown invariant',
                    '',
                    `Database path: ${err.dbPath}`,
                    '',
                    'Choose "Reset Local Data and Relaunch" to delete local Emdash data and start fresh.',
                    'This only removes local app data (projects, tasks, conversations). Repository files are not deleted.',
                ].join('\n'),
                buttons: ['Reset Local Data and Relaunch', 'Quit'],
                defaultId: 0,
                cancelId: 1,
                noLink: true,
            });
            if (result.response === 0) {
                try {
                    await resetLocalDatabase(err.dbPath);
                    electron_1.app.relaunch();
                    electron_1.app.exit(0);
                    return;
                }
                catch (resetError) {
                    console.error('Failed to reset local database:', resetError);
                    electron_1.dialog.showErrorBox('Database Reset Failed', `Unable to delete local database at:\n${err.dbPath}\n\n${resetError instanceof Error ? resetError.message : String(resetError)}`);
                }
            }
            electron_1.app.quit();
            return;
        }
        if (err instanceof Error && err.message.includes('migrations folder')) {
            electron_1.dialog.showErrorBox('Database Initialization Failed', 'Unable to initialize the application database.\n\n' +
                'This may be due to:\n' +
                '• Running from Downloads or DMG (move to Applications)\n' +
                '• Homebrew installation issues (try direct download)\n' +
                '• Incomplete installation\n\n' +
                'Please try:\n' +
                '1. Move Emdash to Applications folder\n' +
                '2. Download directly from GitHub releases\n' +
                '3. Check console for detailed error information');
        }
    }
    // Initialize telemetry (privacy-first, with optional GitHub username)
    await telemetry.init({ installSource: electron_1.app.isPackaged ? 'dmg' : 'dev' });
    // Initialize error tracking
    await errorTracking_1.errorTracking.init();
    try {
        const summary = DatabaseService_1.databaseService.getLastMigrationSummary();
        const toBucket = (n) => (n === 0 ? '0' : n === 1 ? '1' : n <= 3 ? '2-3' : '>3');
        telemetry.capture('db_setup', {
            outcome: dbInitOk ? 'success' : 'failure',
            ...(dbInitOk
                ? {
                    applied_migrations: summary?.appliedCount ?? 0,
                    applied_migrations_bucket: toBucket(summary?.appliedCount ?? 0),
                    recovered: summary?.recovered === true,
                }
                : {
                    error_type: dbInitErrorType ?? 'unknown',
                }),
        });
    }
    catch {
        // telemetry must never crash the app
    }
    // Best-effort: capture a coarse snapshot of project/task counts (no names/paths)
    let localProjectPathsForReserveCleanup = [];
    try {
        const [projects, tasks] = await Promise.all([
            DatabaseService_1.databaseService.getProjects(),
            DatabaseService_1.databaseService.getTasks(),
        ]);
        localProjectPathsForReserveCleanup = projects
            .filter((project) => !project.isRemote)
            .map((project) => project.path);
        const projectCount = projects.length;
        const taskCount = tasks.length;
        const toBucket = (n) => n === 0 ? '0' : n <= 2 ? '1-2' : n <= 5 ? '3-5' : n <= 10 ? '6-10' : '>10';
        telemetry.capture('task_snapshot', {
            project_count: projectCount,
            project_count_bucket: toBucket(projectCount),
            task_count: taskCount,
            task_count_bucket: toBucket(taskCount),
        });
    }
    catch {
        // ignore errors — telemetry is best-effort only
    }
    // Start agent event HTTP server (receives hook callbacks from CLI agents)
    try {
        await AgentEventService_1.agentEventService.start();
    }
    catch (error) {
        console.warn('Failed to start agent event service:', error);
    }
    // Register IPC handlers
    (0, ipc_1.registerAllIpc)();
    // Clean up any orphaned reserve worktrees from previous sessions
    WorktreePoolService_1.worktreePoolService.cleanupOrphanedReserves(localProjectPathsForReserveCleanup).catch((error) => {
        console.warn('Failed to cleanup orphaned reserves:', error);
    });
    // Warm provider installation cache
    try {
        await ConnectionsService_1.connectionsService.initProviderStatusCache();
    }
    catch {
        // best-effort; ignore failures
    }
    // Set up native application menu (Settings, Edit, View, Window)
    (0, menu_1.setupApplicationMenu)();
    // Create main window
    (0, window_1.createMainWindow)();
    // Initialize auto-update service after window is created
    try {
        await AutoUpdateService_1.autoUpdateService.initialize();
    }
    catch (error) {
        if (electron_1.app.isPackaged) {
            console.error('Failed to initialize auto-update service:', error);
        }
    }
});
// App lifecycle handlers
(0, lifecycle_1.registerAppLifecycle)();
// Graceful shutdown telemetry event
electron_1.app.on('before-quit', () => {
    // Session summary with duration (no identifiers)
    telemetry.capture('app_session');
    telemetry.capture('app_closed');
    telemetry.shutdown();
    // Cleanup auto-update service
    AutoUpdateService_1.autoUpdateService.shutdown();
    // Stop agent event HTTP server
    AgentEventService_1.agentEventService.stop();
    // Stop any lifecycle run scripts so they do not outlive the app process.
    TaskLifecycleService_1.taskLifecycleService.shutdown();
    // Cleanup reserve worktrees (fire and forget - don't block quit)
    WorktreePoolService_1.worktreePoolService.cleanup().catch(() => { });
    // Disconnect all SSH connections to avoid orphaned sessions on remote hosts
    SshService_1.sshService.disconnectAll().catch(() => { });
});
