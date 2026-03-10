"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maybeAutoTrustForClaude = maybeAutoTrustForClaude;
exports.ensureClaudeTrust = ensureClaudeTrust;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const crypto_1 = require("crypto");
const logger_1 = require("../lib/logger");
const settings_1 = require("../settings");
function getClaudeConfigPath() {
    return (0, path_1.join)((0, os_1.homedir)(), '.claude.json');
}
/**
 * Auto-trust a worktree directory for Claude Code if the setting is enabled.
 * No-op for non-Claude providers.
 */
function maybeAutoTrustForClaude(providerId, cwd) {
    if (!cwd)
        return;
    if (providerId !== 'claude')
        return;
    if (!(0, settings_1.getAppSettings)().tasks?.autoTrustWorktrees)
        return;
    ensureClaudeTrust(cwd);
}
/**
 * Ensure that Claude Code trusts the given worktree directory by writing
 * the trust entry into ~/.claude.json. Idempotent and non-fatal — errors
 * are logged but never propagated so PTY spawning is never blocked.
 */
function ensureClaudeTrust(worktreePath) {
    try {
        const configPath = getClaudeConfigPath();
        const resolvedPath = (0, path_1.resolve)(worktreePath);
        let config = {};
        if ((0, fs_1.existsSync)(configPath)) {
            const raw = (0, fs_1.readFileSync)(configPath, 'utf8');
            config = JSON.parse(raw);
        }
        if (!config.projects || typeof config.projects !== 'object' || Array.isArray(config.projects)) {
            config.projects = {};
        }
        const existing = config.projects[resolvedPath];
        if (existing &&
            existing.hasTrustDialogAccepted === true &&
            existing.hasCompletedProjectOnboarding === true) {
            return; // Already trusted
        }
        config.projects[resolvedPath] = {
            ...existing,
            hasTrustDialogAccepted: true,
            hasCompletedProjectOnboarding: true,
        };
        // Atomic write: write to temp file then rename
        const tmpPath = configPath + '.' + (0, crypto_1.randomUUID)() + '.tmp';
        try {
            (0, fs_1.writeFileSync)(tmpPath, JSON.stringify(config, null, 2), 'utf8');
            (0, fs_1.renameSync)(tmpPath, configPath);
        }
        catch (writeErr) {
            try {
                (0, fs_1.unlinkSync)(tmpPath);
            }
            catch { }
            throw writeErr;
        }
    }
    catch (err) {
        logger_1.log.warn('ClaudeConfigService: failed to write trust entry', {
            path: worktreePath,
            error: String(err?.message || err),
        });
    }
}
