"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lifecycleScriptsService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../lib/logger");
/**
 * Manages lifecycle scripts for worktrees.
 * Scripts are configured in .emdash.json at the project root.
 */
class LifecycleScriptsService {
    /**
     * Read .emdash.json config from project root
     */
    readConfig(projectPath) {
        try {
            const configPath = path_1.default.join(projectPath, '.emdash.json');
            if (!fs_1.default.existsSync(configPath)) {
                return null;
            }
            const content = fs_1.default.readFileSync(configPath, 'utf8');
            return JSON.parse(content);
        }
        catch (error) {
            logger_1.log.warn('Failed to read .emdash.json', { projectPath, error });
            return null;
        }
    }
    /**
     * Get a specific lifecycle script command if configured.
     */
    getScript(projectPath, phase) {
        const config = this.readConfig(projectPath);
        const scripts = config?.scripts;
        const script = scripts?.[phase];
        return typeof script === 'string' && script.trim().length > 0 ? script.trim() : null;
    }
    /**
     * Get the shell setup command if configured in .emdash.json.
     * Runs inside every PTY (agent and plain terminal) before the shell starts.
     */
    getShellSetup(projectPath) {
        const config = this.readConfig(projectPath);
        const shellSetup = config?.shellSetup;
        return typeof shellSetup === 'string' && shellSetup.trim().length > 0
            ? shellSetup.trim()
            : null;
    }
    /**
     * Check if tmux wrapping is enabled for this project in .emdash.json.
     * When true, agent PTY sessions are wrapped in named tmux sessions
     * for persistence and resumability.
     */
    getTmuxEnabled(projectPath) {
        const config = this.readConfig(projectPath);
        return config?.tmux === true;
    }
}
exports.lifecycleScriptsService = new LifecycleScriptsService();
