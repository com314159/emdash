"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeHookService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../lib/logger");
class ClaudeHookService {
    /**
     * Build the curl command used in Claude Code hook entries.
     *
     * The command pipes stdin directly to curl via `-d @-` to avoid any shell
     * expansion of the payload (which can contain $, backticks, etc. in
     * AI-generated text). The ptyId and event type are sent as HTTP headers
     * instead of being embedded in the JSON body.
     */
    static makeHookCommand(type) {
        return ('curl -sf -X POST ' +
            '-H "Content-Type: application/json" ' +
            '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
            `-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ` +
            `-H "X-Emdash-Event-Type: ${type}" ` +
            '-d @- ' +
            '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true');
    }
    /**
     * Merge emdash hook entries into an existing settings object.
     * Strips old emdash entries (identified by the EMDASH_HOOK_PORT marker),
     * preserves user-defined hooks, and appends fresh Notification + Stop entries.
     * Returns the mutated object.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static mergeHookEntries(existing) {
        const hooks = existing.hooks || {};
        for (const eventType of ['Notification', 'Stop']) {
            const prev = Array.isArray(hooks[eventType]) ? hooks[eventType] : [];
            const userEntries = prev.filter((entry) => !JSON.stringify(entry).includes('EMDASH_HOOK_PORT'));
            userEntries.push({
                hooks: [
                    { type: 'command', command: ClaudeHookService.makeHookCommand(eventType.toLowerCase()) },
                ],
            });
            hooks[eventType] = userEntries;
        }
        existing.hooks = hooks;
        return existing;
    }
    static writeHookConfig(worktreePath) {
        const claudeDir = path_1.default.join(worktreePath, '.claude');
        const settingsPath = path_1.default.join(claudeDir, 'settings.local.json');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let existing = {};
        try {
            const content = fs_1.default.readFileSync(settingsPath, 'utf-8');
            existing = JSON.parse(content);
        }
        catch {
            // File doesn't exist or isn't valid JSON — start fresh
        }
        try {
            fs_1.default.mkdirSync(claudeDir, { recursive: true });
        }
        catch {
            // May already exist
        }
        ClaudeHookService.mergeHookEntries(existing);
        try {
            fs_1.default.writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n');
        }
        catch (err) {
            logger_1.log.warn('ClaudeHookService: failed to write hook config', {
                path: settingsPath,
                error: String(err),
            });
        }
    }
}
exports.ClaudeHookService = ClaudeHookService;
