"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureProjectPrepared = ensureProjectPrepared;
const fs_1 = require("fs");
const path_1 = require("path");
const child_process_1 = require("child_process");
function pickNodeInstallCmd(target) {
    // Prefer package manager based on lockfile presence
    if ((0, fs_1.existsSync)((0, path_1.join)(target, 'pnpm-lock.yaml'))) {
        return ['pnpm install --frozen-lockfile', 'pnpm install'];
    }
    if ((0, fs_1.existsSync)((0, path_1.join)(target, 'yarn.lock'))) {
        // Support modern Yarn (Berry) and classic Yarn
        return ['yarn install --immutable', 'yarn install --frozen-lockfile', 'yarn install'];
    }
    if ((0, fs_1.existsSync)((0, path_1.join)(target, 'bun.lockb'))) {
        return ['bun install'];
    }
    if ((0, fs_1.existsSync)((0, path_1.join)(target, 'package-lock.json'))) {
        return ['npm ci', 'npm install'];
    }
    return ['npm install'];
}
function runInBackground(cmd, cwd) {
    const command = Array.isArray(cmd) ? cmd.filter(Boolean).join(' || ') : cmd;
    const child = (0, child_process_1.spawn)(command, {
        cwd,
        shell: true,
        stdio: 'ignore',
        windowsHide: true,
        detached: process.platform !== 'win32',
    });
    // Avoid unhandled errors from bubbling; ignore failures silently
    child.on('error', () => { });
    child.unref?.();
}
/**
 * Best-effort dependency prep for common project types.
 * Non-blocking; spawns installs in background if needed.
 */
async function ensureProjectPrepared(targetPath) {
    try {
        // Node projects: if package.json exists and node_modules missing, install deps
        const isNode = (0, fs_1.existsSync)((0, path_1.join)(targetPath, 'package.json'));
        const hasNodeModules = (0, fs_1.existsSync)((0, path_1.join)(targetPath, 'node_modules'));
        if (isNode && !hasNodeModules) {
            const cmds = pickNodeInstallCmd(targetPath);
            runInBackground(cmds, targetPath);
        }
        // Optional: we could add Python prep here later if desired
    }
    catch {
        // ignore
    }
}
