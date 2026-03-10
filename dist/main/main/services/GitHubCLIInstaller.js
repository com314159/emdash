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
exports.githubCLIInstaller = exports.GitHubCLIInstaller = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const os = __importStar(require("os"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class GitHubCLIInstaller {
    /**
     * Check if gh CLI is installed
     */
    async isInstalled() {
        try {
            await execAsync('gh --version');
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Attempt to install gh CLI automatically
     */
    async install() {
        const platform = os.platform();
        try {
            switch (platform) {
                case 'darwin': // macOS
                    return await this.installMacOS();
                case 'linux':
                    return await this.installLinux();
                case 'win32':
                    return await this.installWindows();
                default:
                    return { success: false, error: `Unsupported platform: ${platform}` };
            }
        }
        catch (error) {
            console.error('Failed to install gh CLI:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Installation failed',
            };
        }
    }
    async installMacOS() {
        try {
            // Check if Homebrew is installed
            await execAsync('which brew');
            // Install gh using Homebrew
            await execAsync('brew install gh');
            return { success: true };
        }
        catch (error) {
            return {
                success: false,
                error: 'Homebrew not found. Please install from https://brew.sh/ first.',
            };
        }
    }
    async installLinux() {
        try {
            // Try apt (Debian/Ubuntu)
            await execAsync('sudo apt update && sudo apt install -y gh');
            return { success: true };
        }
        catch {
            return {
                success: false,
                error: 'Could not install gh CLI. Please install manually: https://cli.github.com/',
            };
        }
    }
    async installWindows() {
        try {
            // Try winget
            await execAsync('winget install GitHub.cli');
            return { success: true };
        }
        catch {
            return {
                success: false,
                error: 'Could not install gh CLI. Please install manually: https://cli.github.com/',
            };
        }
    }
}
exports.GitHubCLIInstaller = GitHubCLIInstaller;
exports.githubCLIInstaller = new GitHubCLIInstaller();
