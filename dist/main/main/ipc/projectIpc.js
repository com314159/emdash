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
exports.registerProjectIpc = registerProjectIpc;
const electron_1 = require("electron");
const path_1 = require("path");
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const window_1 = require("../app/window");
const errorTracking_1 = require("../errorTracking");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const DEFAULT_REMOTE = 'origin';
const DEFAULT_BRANCH = 'main';
const normalizeRemoteName = (remote) => {
    if (!remote)
        return DEFAULT_REMOTE;
    const trimmed = remote.trim();
    if (!trimmed)
        return ''; // Empty string indicates no remote (local-only repo)
    if (/^[A-Za-z0-9._-]+$/.test(trimmed) && !trimmed.includes('://')) {
        return trimmed;
    }
    return DEFAULT_REMOTE;
};
const computeBaseRef = (remote, branch) => {
    const remoteName = normalizeRemoteName(remote);
    if (branch && branch.trim().length > 0) {
        const trimmed = branch.trim();
        if (trimmed.includes('/'))
            return trimmed;
        // Prepend remote only if one exists
        return remoteName ? `${remoteName}/${trimmed}` : trimmed;
    }
    // Default: use origin/main if remote exists, otherwise just 'main'
    return remoteName ? `${remoteName}/${DEFAULT_BRANCH}` : DEFAULT_BRANCH;
};
const detectDefaultBranch = async (projectPath, remote) => {
    const remoteName = normalizeRemoteName(remote);
    // If no remote, try to detect the current local branch
    if (!remoteName) {
        try {
            const { stdout } = await execAsync('git branch --show-current', {
                cwd: projectPath,
            });
            return stdout.trim() || null;
        }
        catch {
            return null;
        }
    }
    // Try to get remote's default branch
    try {
        const { stdout } = await execAsync(`git remote show ${remoteName}`, {
            cwd: projectPath,
        });
        const match = stdout.match(/HEAD branch:\s*(\S+)/);
        return match ? match[1] : null;
    }
    catch {
        return null;
    }
};
function registerProjectIpc() {
    electron_1.ipcMain.handle('project:open', async () => {
        try {
            const result = await electron_1.dialog.showOpenDialog((0, window_1.getMainWindow)(), {
                title: 'Open Project',
                properties: ['openDirectory'],
                message: 'Select a project directory to open',
            });
            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, error: 'No directory selected' };
            }
            const projectPath = result.filePaths[0];
            return { success: true, path: projectPath };
        }
        catch (error) {
            console.error('Failed to open project:', error);
            // Track project open errors
            await errorTracking_1.errorTracking.captureProjectError(error, 'open');
            return { success: false, error: 'Failed to open project directory' };
        }
    });
    electron_1.ipcMain.handle('project:openFile', async (_, args) => {
        try {
            const result = await electron_1.dialog.showOpenDialog((0, window_1.getMainWindow)(), {
                title: args?.title || 'Select File',
                properties: ['openFile'],
                message: args?.message || 'Select a file',
                filters: args?.filters,
            });
            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, error: 'No file selected' };
            }
            return { success: true, path: result.filePaths[0] };
        }
        catch (error) {
            console.error('Failed to open file dialog:', error);
            return { success: false, error: 'Failed to open file selector' };
        }
    });
    electron_1.ipcMain.handle('git:getInfo', async (_, projectPath) => {
        try {
            const resolveRealPath = async (target) => {
                try {
                    return await fs.promises.realpath(target);
                }
                catch {
                    return target;
                }
            };
            const resolvedProjectPath = await resolveRealPath(projectPath);
            const gitPath = (0, path_1.join)(resolvedProjectPath, '.git');
            const isGitRepo = fs.existsSync(gitPath);
            if (!isGitRepo) {
                return { isGitRepo: false, path: resolvedProjectPath };
            }
            // Get remote URL
            let remote = null;
            try {
                const { stdout } = await execAsync('git remote get-url origin', {
                    cwd: resolvedProjectPath,
                });
                remote = stdout.trim();
            }
            catch { }
            // Get current branch
            let branch = null;
            try {
                const { stdout } = await execAsync('git branch --show-current', {
                    cwd: resolvedProjectPath,
                });
                branch = stdout.trim();
            }
            catch { }
            let defaultBranch = null;
            if (!branch) {
                defaultBranch = await detectDefaultBranch(resolvedProjectPath, remote);
            }
            let upstream = null;
            let aheadCount = null;
            let behindCount = null;
            try {
                const { stdout } = await execAsync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', {
                    cwd: resolvedProjectPath,
                });
                upstream = stdout.trim();
            }
            catch { }
            if (upstream) {
                try {
                    const { stdout } = await execAsync('git rev-list --left-right --count HEAD...@{u}', {
                        cwd: resolvedProjectPath,
                    });
                    const [ahead, behind] = stdout.trim().split(/\s+/);
                    aheadCount = Number.parseInt(ahead, 10);
                    behindCount = Number.parseInt(behind, 10);
                }
                catch { }
            }
            let rootPath = null;
            try {
                const { stdout } = await execAsync('git rev-parse --show-toplevel', {
                    cwd: resolvedProjectPath,
                });
                const trimmed = stdout.trim();
                if (trimmed) {
                    rootPath = await resolveRealPath(trimmed);
                }
            }
            catch { }
            const baseRef = computeBaseRef(remote, branch || defaultBranch);
            const safeAhead = typeof aheadCount === 'number' && Number.isFinite(aheadCount) ? aheadCount : undefined;
            const safeBehind = typeof behindCount === 'number' && Number.isFinite(behindCount) ? behindCount : undefined;
            return {
                isGitRepo: true,
                remote,
                branch,
                baseRef,
                upstream,
                aheadCount: safeAhead,
                behindCount: safeBehind,
                path: resolvedProjectPath,
                rootPath: rootPath || resolvedProjectPath,
            };
        }
        catch (error) {
            console.error('Failed to get Git info:', error);
            return { isGitRepo: false, error: 'Failed to read Git information', path: projectPath };
        }
    });
}
