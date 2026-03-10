"use strict";
/**
 * Utility functions for detecting shell environment variables
 * when the Electron app is launched from the GUI (not from terminal).
 */
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
exports.getShellEnvVar = getShellEnvVar;
exports.detectSshAuthSock = detectSshAuthSock;
exports.initializeShellEnvironment = initializeShellEnvironment;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
/**
 * Gets an environment variable from the user's login shell.
 * This is useful when the app is launched from GUI and doesn't
 * inherit the shell's environment.
 *
 * @param varName - Name of the environment variable to retrieve
 * @returns The value of the environment variable, or undefined if not found
 */
function getShellEnvVar(varName) {
    try {
        if (!/^[A-Z0-9_]+$/.test(varName)) {
            return undefined;
        }
        const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
        // -i = interactive, -l = login shell (sources .zshrc/.bash_profile)
        const result = (0, child_process_1.execSync)(`${shell} -ilc 'printenv ${varName} || true'`, {
            encoding: 'utf8',
            timeout: 5000,
            env: {
                ...process.env,
                // Prevent oh-my-zsh plugins from breaking output
                DISABLE_AUTO_UPDATE: 'true',
                ZSH_TMUX_AUTOSTART: 'false',
                ZSH_TMUX_AUTOSTARTED: 'true',
            },
        });
        const value = result.trim();
        return value || undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Common SSH agent socket locations to check as fallback
 */
const COMMON_SSH_AGENT_LOCATIONS = [
    // macOS launchd
    { path: '/private/tmp/com.apple.launchd.*/Listeners', description: 'macOS launchd' },
    // 1Password SSH agent (macOS)
    {
        path: path.join(os.homedir(), 'Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock'),
        description: '1Password SSH agent',
    },
    // Generic temp directory patterns
    { path: path.join(os.tmpdir(), 'ssh-??????????', 'agent.*'), description: 'OpenSSH temp' },
    // User's .ssh directory
    { path: path.join(os.homedir(), '.ssh', 'agent.*'), description: 'User SSH directory' },
    // Linux keyring
    { path: path.join(os.tmpdir(), 'keyring-*/ssh'), description: 'GNOME Keyring' },
    // GnuPG agent SSH support
    { path: path.join(os.homedir(), '.gnupg', 'S.gpg-agent.ssh'), description: 'GnuPG agent' },
];
/**
 * Checks if a path is a socket file
 */
function isSocketFile(filePath) {
    try {
        const stats = fs.statSync(filePath);
        return stats.isSocket();
    }
    catch {
        return false;
    }
}
/**
 * Expands glob patterns to find matching paths
 */
function expandGlob(pattern) {
    try {
        // Simple glob expansion for patterns like /tmp/ssh-*/agent.*
        const parts = pattern.split('/');
        let matches = [''];
        for (const part of parts) {
            if (!part)
                continue;
            if (part.includes('*') || part.includes('?')) {
                // This part has wildcards
                const regex = new RegExp('^' + part.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
                const newMatches = [];
                for (const currentPath of matches) {
                    try {
                        const dir = currentPath || '/';
                        const entries = fs.readdirSync(dir);
                        for (const entry of entries) {
                            if (regex.test(entry)) {
                                newMatches.push(path.join(currentPath, entry));
                            }
                        }
                    }
                    catch { }
                }
                matches = newMatches;
            }
            else {
                // Regular path component
                matches = matches.map((m) => path.join(m, part));
            }
        }
        return matches.filter((m) => m !== '');
    }
    catch {
        return [];
    }
}
/**
 * Detects the SSH_AUTH_SOCK environment variable.
 * First checks if it's already set, then tries to detect from shell,
 * and finally checks common socket locations.
 *
 * @returns The path to the SSH agent socket, or undefined if not found
 */
function detectSshAuthSock() {
    // On macOS, check launchctl first — it reflects the user's explicit override
    // (e.g. `launchctl setenv SSH_AUTH_SOCK /path/to/1password/agent.sock`)
    // which may differ from the process.env value inherited from the default
    // Apple SSH agent when launched from Finder/Dock.
    if (process.platform === 'darwin') {
        try {
            const result = (0, child_process_1.execSync)('launchctl getenv SSH_AUTH_SOCK', {
                encoding: 'utf8',
                timeout: 1000,
            });
            const socket = result.trim();
            if (socket) {
                return socket;
            }
        }
        catch {
            // launchctl detection failed, continue
        }
    }
    // If already set in environment, use it
    if (process.env.SSH_AUTH_SOCK) {
        return process.env.SSH_AUTH_SOCK;
    }
    // Try to detect from user's login shell (sources .zshrc/.bash_profile)
    const shellValue = getShellEnvVar('SSH_AUTH_SOCK');
    if (shellValue) {
        return shellValue;
    }
    // Check common socket locations as fallback
    for (const location of COMMON_SSH_AGENT_LOCATIONS) {
        try {
            if (location.path.includes('*') || location.path.includes('?')) {
                const matches = expandGlob(location.path);
                for (const match of matches) {
                    if (isSocketFile(match)) {
                        return match;
                    }
                }
            }
            else if (isSocketFile(location.path)) {
                return location.path;
            }
        }
        catch {
            // Continue to next location
        }
    }
    return undefined;
}
/**
 * Initializes shell environment detection and sets process.env variables.
 * Should be called early in the main process before app is ready.
 */
function initializeShellEnvironment() {
    const sshAuthSock = detectSshAuthSock();
    if (sshAuthSock) {
        process.env.SSH_AUTH_SOCK = sshAuthSock;
        console.log('[shellEnv] Detected SSH_AUTH_SOCK:', sshAuthSock);
    }
    else {
        console.log('[shellEnv] SSH_AUTH_SOCK not detected');
    }
}
