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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.worktreeService = exports.WorktreeService = void 0;
const child_process_1 = require("child_process");
const logger_1 = require("../lib/logger");
const util_1 = require("util");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const ProjectSettingsService_1 = require("./ProjectSettingsService");
const minimatch_1 = require("minimatch");
const errorTracking_1 = require("../errorTracking");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/** Default patterns for files to preserve when creating worktrees */
const DEFAULT_PRESERVE_PATTERNS = [
    '.env',
    '.env.keys',
    '.env.local',
    '.env.*.local',
    '.envrc',
    'docker-compose.override.yml',
];
/** Default path segments to exclude from preservation */
const DEFAULT_EXCLUDE_PATTERNS = [
    'node_modules',
    '.git',
    'vendor',
    '.cache',
    'dist',
    'build',
    '.next',
    '.nuxt',
    '__pycache__',
    '.venv',
    'venv',
];
class WorktreeService {
    constructor() {
        this.worktrees = new Map();
    }
    async cleanupWorktreeDirectory(pathToRemove, projectPath) {
        if (!fs_1.default.existsSync(pathToRemove)) {
            return;
        }
        const normalizedPathToRemove = path_1.default.resolve(pathToRemove);
        const normalizedProjectPath = path_1.default.resolve(projectPath);
        if (normalizedPathToRemove === normalizedProjectPath) {
            logger_1.log.error(`CRITICAL: Prevented filesystem removal of main repository! Path: ${pathToRemove}`);
            return;
        }
        const isLikelyWorktree = pathToRemove.includes('/worktrees/') ||
            pathToRemove.includes('\\worktrees\\') ||
            pathToRemove.includes('/.conductor/') ||
            pathToRemove.includes('\\.conductor\\') ||
            pathToRemove.includes('/.cursor/worktrees/') ||
            pathToRemove.includes('\\.cursor\\worktrees\\');
        if (!isLikelyWorktree) {
            logger_1.log.warn(`Path doesn't appear to be a worktree directory, skipping filesystem removal: ${pathToRemove}`);
            return;
        }
        try {
            await fs_1.default.promises.rm(pathToRemove, { recursive: true, force: true });
        }
        catch (rmErr) {
            if (rmErr && (rmErr.code === 'EACCES' || rmErr.code === 'EPERM')) {
                try {
                    if (process.platform === 'win32') {
                        await execFileAsync('cmd', ['/c', 'attrib', '-R', '/S', '/D', pathToRemove + '\\*']);
                    }
                    else {
                        await execFileAsync('chmod', ['-R', 'u+w', pathToRemove]);
                    }
                }
                catch (permErr) {
                    logger_1.log.warn('Failed to adjust permissions for worktree cleanup:', permErr);
                }
                try {
                    await fs_1.default.promises.rm(pathToRemove, { recursive: true, force: true });
                }
                catch (retryErr) {
                    logger_1.log.warn('Failed to cleanup worktree directory after permission fix:', retryErr);
                }
            }
            else {
                logger_1.log.warn('Failed to cleanup worktree directory:', rmErr);
            }
        }
    }
    /**
     * Read .emdash.json config from project root
     */
    readProjectConfig(projectPath) {
        try {
            const configPath = path_1.default.join(projectPath, '.emdash.json');
            if (!fs_1.default.existsSync(configPath)) {
                return null;
            }
            const content = fs_1.default.readFileSync(configPath, 'utf8');
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
    /**
     * Get preserve patterns for a project (config or defaults)
     */
    getPreservePatterns(projectPath) {
        const config = this.readProjectConfig(projectPath);
        if (config?.preservePatterns && Array.isArray(config.preservePatterns)) {
            return config.preservePatterns;
        }
        return DEFAULT_PRESERVE_PATTERNS;
    }
    /**
     * Preserve project files into a worktree using project config (or defaults).
     */
    async preserveProjectFilesToWorktree(projectPath, worktreePath) {
        const patterns = this.getPreservePatterns(projectPath);
        return this.preserveFilesToWorktree(projectPath, worktreePath, patterns);
    }
    /** Slugify task name to make it shell-safe */
    slugify(name) {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }
    /** Generate a short 3-char alphanumeric hash for branch uniqueness */
    generateShortHash() {
        const bytes = crypto_1.default.randomBytes(3);
        return bytes.readUIntBE(0, 3).toString(36).slice(0, 3).padStart(3, '0');
    }
    /** Generate a stable ID from the absolute worktree path */
    stableIdFromPath(worktreePath) {
        const abs = path_1.default.resolve(worktreePath);
        const h = crypto_1.default.createHash('sha1').update(abs).digest('hex').slice(0, 12);
        return `wt-${h}`;
    }
    /**
     * Create a new Git worktree for an agent task
     */
    async createWorktree(projectPath, taskName, projectId, baseRef) {
        // Declare variables outside try block for access in catch block
        let branchName;
        let worktreePath;
        const sluggedName = this.slugify(taskName);
        const hash = this.generateShortHash();
        try {
            const { getAppSettings } = await Promise.resolve().then(() => __importStar(require('../settings')));
            const settings = getAppSettings();
            const prefix = settings?.repository?.branchPrefix || 'emdash';
            branchName = this.sanitizeBranchName(`${prefix}/${sluggedName}-${hash}`);
            worktreePath = path_1.default.join(projectPath, '..', `worktrees/${sluggedName}-${hash}`);
            const worktreeId = this.stableIdFromPath(worktreePath);
            logger_1.log.info(`Creating worktree: ${branchName} -> ${worktreePath}`);
            // Check if worktree path already exists
            if (fs_1.default.existsSync(worktreePath)) {
                throw new Error(`Worktree directory already exists: ${worktreePath}`);
            }
            // Ensure worktrees directory exists
            const worktreesDir = path_1.default.dirname(worktreePath);
            if (!fs_1.default.existsSync(worktreesDir)) {
                fs_1.default.mkdirSync(worktreesDir, { recursive: true });
            }
            // Use provided baseRef override or resolve from project settings
            let baseRefInfo;
            if (baseRef) {
                const parsed = await this.parseBaseRef(baseRef, projectPath);
                if (parsed) {
                    baseRefInfo = parsed;
                }
                else {
                    // If parsing failed, fall back to project settings
                    logger_1.log.warn(`Failed to parse provided baseRef '${baseRef}', falling back to project settings`);
                    baseRefInfo = await this.resolveProjectBaseRef(projectPath, projectId);
                }
            }
            else {
                baseRefInfo = await this.resolveProjectBaseRef(projectPath, projectId);
            }
            const fetchedBaseRef = await this.fetchBaseRefWithFallback(projectPath, projectId, baseRefInfo);
            // Create the worktree with --no-track to prevent auto-tracking base ref
            // Tracking is set explicitly via push --set-upstream after creation
            const { stdout, stderr } = await execFileAsync('git', ['worktree', 'add', '--no-track', '-b', branchName, worktreePath, fetchedBaseRef.fullRef], { cwd: projectPath });
            logger_1.log.debug('Git worktree stdout:', stdout);
            logger_1.log.debug('Git worktree stderr:', stderr);
            // Verify the worktree was actually created
            if (!fs_1.default.existsSync(worktreePath)) {
                throw new Error(`Worktree directory was not created: ${worktreePath}`);
            }
            // Preserve .env and other gitignored config files from source to worktree
            try {
                await this.preserveProjectFilesToWorktree(projectPath, worktreePath);
            }
            catch (preserveErr) {
                logger_1.log.warn('Failed to preserve files to worktree (continuing):', preserveErr);
            }
            await this.logWorktreeSyncStatus(projectPath, worktreePath, fetchedBaseRef);
            const worktreeInfo = {
                id: worktreeId,
                name: taskName,
                branch: branchName,
                path: worktreePath,
                projectId,
                status: 'active',
                createdAt: new Date().toISOString(),
            };
            this.worktrees.set(worktreeInfo.id, worktreeInfo);
            logger_1.log.info(`Created worktree: ${taskName} -> ${branchName}`);
            // Push the new branch to origin and set upstream so PRs work out of the box
            // Only if a remote exists
            if (settings?.repository?.pushOnCreate !== false && fetchedBaseRef.remote) {
                try {
                    await execFileAsync('git', ['push', '--set-upstream', fetchedBaseRef.remote, branchName], {
                        cwd: worktreePath,
                    });
                    logger_1.log.info(`Pushed branch ${branchName} to ${fetchedBaseRef.remote} with upstream tracking`);
                }
                catch (pushErr) {
                    logger_1.log.warn('Initial push of worktree branch failed:', pushErr);
                    // Don't fail worktree creation if push fails - user can push manually later
                }
            }
            else if (!fetchedBaseRef.remote) {
                logger_1.log.info(`Skipping push for worktree branch ${branchName} - no remote configured (local-only repo)`);
            }
            return worktreeInfo;
        }
        catch (error) {
            logger_1.log.error('Failed to create worktree:', error);
            const message = error instanceof Error ? error.message : String(error);
            // Track worktree creation errors
            await errorTracking_1.errorTracking.captureWorktreeError(error, 'create', worktreePath, branchName, {
                project_id: projectId,
                project_path: projectPath,
                task_name: taskName,
                hash: hash,
            });
            throw new Error(message || 'Failed to create worktree');
        }
    }
    async fetchLatestBaseRef(projectPath, projectId) {
        const baseRefInfo = await this.resolveProjectBaseRef(projectPath, projectId);
        const fetched = await this.fetchBaseRefWithFallback(projectPath, projectId, baseRefInfo);
        return fetched;
    }
    /**
     * List all worktrees for a project
     */
    async listWorktrees(projectPath) {
        try {
            const { stdout } = await execFileAsync('git', ['worktree', 'list'], {
                cwd: projectPath,
            });
            const worktrees = [];
            const lines = stdout.trim().split('\n');
            // Compute managed prefixes based on configured prefix
            let managedPrefixes = ['emdash', 'agent', 'pr', 'orch'];
            try {
                const { getAppSettings } = await Promise.resolve().then(() => __importStar(require('../settings')));
                const settings = getAppSettings();
                const p = settings?.repository?.branchPrefix;
                if (p)
                    managedPrefixes = Array.from(new Set([p, ...managedPrefixes]));
            }
            catch { }
            for (const line of lines) {
                if (line.includes('[') && line.includes(']')) {
                    const parts = line.split(/\s+/);
                    const worktreePath = parts[0];
                    const branchMatch = line.match(/\[([^\]]+)\]/);
                    const branch = branchMatch ? branchMatch[1] : 'unknown';
                    const managedBranch = managedPrefixes.some((pf) => {
                        return (branch.startsWith(pf + '/') ||
                            branch.startsWith(pf + '-') ||
                            branch.startsWith(pf + '_') ||
                            branch.startsWith(pf + '.') ||
                            branch === pf);
                    });
                    if (!managedBranch) {
                        const tracked = Array.from(this.worktrees.values()).find((wt) => wt.path === worktreePath);
                        if (!tracked)
                            continue;
                    }
                    const existing = Array.from(this.worktrees.values()).find((wt) => wt.path === worktreePath);
                    worktrees.push(existing ?? {
                        id: this.stableIdFromPath(worktreePath),
                        name: path_1.default.basename(worktreePath),
                        branch,
                        path: worktreePath,
                        projectId: path_1.default.basename(projectPath),
                        status: 'active',
                        createdAt: new Date().toISOString(),
                    });
                }
            }
            return worktrees;
        }
        catch (error) {
            logger_1.log.error('Failed to list worktrees:', error);
            return [];
        }
    }
    /** Sanitize branch name to ensure it's a valid Git ref */
    sanitizeBranchName(name) {
        let n = name
            .replace(/\s+/g, '-')
            .replace(/[^A-Za-z0-9._\/-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/\/+/g, '/');
        n = n.replace(/^[./-]+/, '').replace(/[./-]+$/, '');
        if (!n || n === 'HEAD') {
            n = `emdash/${this.slugify('task')}-${this.generateShortHash()}`;
        }
        return n;
    }
    /** Remove a worktree */
    async removeWorktree(projectPath, worktreeId, worktreePath, branch) {
        try {
            const worktree = this.worktrees.get(worktreeId);
            const pathToRemove = worktree?.path ?? worktreePath;
            const branchToDelete = worktree?.branch ?? branch;
            if (!pathToRemove) {
                throw new Error('Worktree path not provided');
            }
            // CRITICAL SAFETY CHECK: Prevent removing the main repository
            // Check if the path to remove is the same as the project path (main repo)
            const normalizedPathToRemove = path_1.default.resolve(pathToRemove);
            const normalizedProjectPath = path_1.default.resolve(projectPath);
            if (normalizedPathToRemove === normalizedProjectPath) {
                logger_1.log.error(`CRITICAL: Attempted to remove main repository! Path: ${pathToRemove}, Project: ${projectPath}`);
                throw new Error('Cannot remove main repository - this is not a worktree');
            }
            // Additional safety: Check if this is actually a worktree using git worktree list
            try {
                const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
                    cwd: projectPath,
                });
                // Parse the output to find if pathToRemove is a worktree
                const lines = stdout.split('\n');
                let isWorktree = false;
                let isMainWorktree = false;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith('worktree ')) {
                        const wtPath = lines[i].substring(9); // Remove "worktree " prefix
                        const normalizedWtPath = path_1.default.resolve(wtPath);
                        if (normalizedWtPath === normalizedPathToRemove) {
                            // Check if this is the main worktree (bare repos have no main worktree)
                            const nextLine = lines[i + 1];
                            if (nextLine && nextLine === 'bare') {
                                isMainWorktree = true;
                            }
                            else if (i === 0) {
                                // First worktree in the list is usually the main worktree
                                isMainWorktree = true;
                            }
                            isWorktree = true;
                            break;
                        }
                    }
                }
                if (isMainWorktree) {
                    logger_1.log.error(`CRITICAL: Attempted to remove main worktree! Path: ${pathToRemove}`);
                    throw new Error('Cannot remove main worktree');
                }
                if (!isWorktree) {
                    logger_1.log.warn(`Path is not a git worktree, skipping removal: ${pathToRemove}`);
                    // Don't throw error, just return - the path might not exist or might be a task without worktree
                    return;
                }
            }
            catch (checkError) {
                logger_1.log.warn('Could not verify worktree status, proceeding with caution:', checkError);
                // If we can't verify, at least we've checked it's not the main project path above
            }
            // Remove the worktree directory via git first
            try {
                // Use --force to remove even when there are untracked/modified files
                await execFileAsync('git', ['worktree', 'remove', '--force', pathToRemove], {
                    cwd: projectPath,
                });
            }
            catch (gitError) {
                console.warn('git worktree remove failed, attempting filesystem cleanup', gitError);
            }
            // Best-effort prune to clear any stale worktree metadata that can keep a branch "checked out"
            try {
                await execFileAsync('git', ['worktree', 'prune', '--verbose'], { cwd: projectPath });
            }
            catch (pruneErr) {
                console.warn('git worktree prune failed (continuing):', pruneErr);
            }
            // Ensure directory is removed even if git command failed
            void this.cleanupWorktreeDirectory(pathToRemove, projectPath);
            if (branchToDelete) {
                const tryDeleteBranch = async () => await execFileAsync('git', ['branch', '-D', branchToDelete], { cwd: projectPath });
                try {
                    await tryDeleteBranch();
                }
                catch (branchError) {
                    const msg = String(branchError?.stderr || branchError?.message || branchError);
                    // If git thinks the branch is still checked out in a (now removed) worktree,
                    // prune and retry once more.
                    if (/checked out at /.test(msg)) {
                        try {
                            await execFileAsync('git', ['worktree', 'prune', '--verbose'], { cwd: projectPath });
                            await tryDeleteBranch();
                        }
                        catch (retryErr) {
                            console.warn(`Failed to delete branch ${branchToDelete} after prune:`, retryErr);
                        }
                    }
                    else {
                        console.warn(`Failed to delete branch ${branchToDelete}:`, branchError);
                    }
                }
                // Only try to delete remote branch if a remote exists
                const remoteAlias = 'origin';
                const hasRemote = await this.hasRemote(projectPath, remoteAlias);
                if (hasRemote) {
                    let remoteBranchName = branchToDelete;
                    if (branchToDelete.startsWith('origin/')) {
                        remoteBranchName = branchToDelete.replace(/^origin\//, '');
                    }
                    try {
                        await execFileAsync('git', ['push', remoteAlias, '--delete', remoteBranchName], {
                            cwd: projectPath,
                        });
                        logger_1.log.info(`Deleted remote branch ${remoteAlias}/${remoteBranchName}`);
                    }
                    catch (remoteError) {
                        const msg = String(remoteError?.stderr || remoteError?.message || remoteError);
                        if (/remote ref does not exist/i.test(msg) ||
                            /unknown revision/i.test(msg) ||
                            /not found/i.test(msg)) {
                            logger_1.log.info(`Remote branch ${remoteAlias}/${remoteBranchName} already absent`);
                        }
                        else {
                            logger_1.log.warn(`Failed to delete remote branch ${remoteAlias}/${remoteBranchName}:`, remoteError);
                        }
                    }
                }
                else {
                    logger_1.log.info(`Skipping remote branch deletion - no remote configured (local-only repo)`);
                }
            }
            if (worktree) {
                this.worktrees.delete(worktreeId);
                logger_1.log.info(`Removed worktree: ${worktree.name}`);
            }
            else {
                logger_1.log.info(`Removed worktree ${worktreeId}`);
            }
        }
        catch (error) {
            logger_1.log.error('Failed to remove worktree:', error);
            throw new Error(`Failed to remove worktree: ${error}`);
        }
    }
    /**
     * Get worktree status and changes
     */
    async getWorktreeStatus(worktreePath) {
        try {
            const { stdout: status } = await execFileAsync('git', ['status', '--porcelain', '--untracked-files=all'], {
                cwd: worktreePath,
            });
            const stagedFiles = [];
            const unstagedFiles = [];
            const untrackedFiles = [];
            const lines = status
                .trim()
                .split('\n')
                .filter((line) => line.length > 0);
            for (const line of lines) {
                const status = line.substring(0, 2);
                const file = line.substring(3);
                if (status.includes('A') || status.includes('M') || status.includes('D')) {
                    stagedFiles.push(file);
                }
                if (status.includes('M') || status.includes('D')) {
                    unstagedFiles.push(file);
                }
                if (status.includes('??')) {
                    untrackedFiles.push(file);
                }
            }
            return {
                hasChanges: stagedFiles.length > 0 || unstagedFiles.length > 0 || untrackedFiles.length > 0,
                stagedFiles,
                unstagedFiles,
                untrackedFiles,
            };
        }
        catch (error) {
            logger_1.log.error('Failed to get worktree status:', error);
            return {
                hasChanges: false,
                stagedFiles: [],
                unstagedFiles: [],
                untrackedFiles: [],
            };
        }
    }
    /**
     * Get the default branch of a repository
     */
    async getDefaultBranch(projectPath) {
        // Check if origin remote exists first
        const hasOrigin = await this.hasRemote(projectPath, 'origin');
        if (!hasOrigin) {
            // No remote - try to get current branch
            try {
                const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
                    cwd: projectPath,
                });
                const current = stdout.trim();
                if (current)
                    return current;
            }
            catch {
                // Fallback to 'main'
            }
            return 'main';
        }
        // Has remote - try to get its default branch
        try {
            const { stdout } = await execFileAsync('git', ['remote', 'show', 'origin'], {
                cwd: projectPath,
            });
            const match = stdout.match(/HEAD branch:\s*(\S+)/);
            return match ? match[1] : 'main';
        }
        catch {
            return 'main';
        }
    }
    async parseBaseRef(ref, projectPath) {
        if (!ref)
            return null;
        const cleaned = ref
            .trim()
            .replace(/^refs\/remotes\//, '')
            .replace(/^remotes\//, '');
        if (!cleaned)
            return null;
        // Check if this looks like a remote/branch ref
        const slashIndex = cleaned.indexOf('/');
        if (slashIndex > 0) {
            const potentialRemote = cleaned.substring(0, slashIndex);
            const branch = cleaned.substring(slashIndex + 1);
            if (branch) {
                // Verify if potentialRemote is actually a git remote
                if (projectPath) {
                    try {
                        const { stdout } = await execFileAsync('git', ['remote'], { cwd: projectPath });
                        const remotes = (stdout || '').trim().split('\n').filter(Boolean);
                        if (remotes.includes(potentialRemote)) {
                            return { remote: potentialRemote, branch, fullRef: cleaned };
                        }
                        // Not a valid remote, fall through to treat as local branch
                    }
                    catch {
                        // Can't check remotes, assume it's a remote ref
                        return { remote: potentialRemote, branch, fullRef: cleaned };
                    }
                }
                else {
                    // No projectPath to verify, assume it's a remote ref
                    return { remote: potentialRemote, branch, fullRef: cleaned };
                }
            }
        }
        // Treat as a local branch (no remote prefix)
        return { remote: '', branch: cleaned, fullRef: cleaned };
    }
    async resolveProjectBaseRef(projectPath, projectId) {
        const settings = await ProjectSettingsService_1.projectSettingsService.getProjectSettings(projectId);
        if (!settings) {
            throw new Error('Project settings not found. Please re-open the project in Emdash and try again.');
        }
        const parsed = await this.parseBaseRef(settings.baseRef, projectPath);
        if (parsed) {
            return parsed;
        }
        // If parseBaseRef returned null, it might be a local branch name
        // Check if the baseRef exists as a local branch
        if (settings.baseRef) {
            try {
                const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', `refs/heads/${settings.baseRef}`], { cwd: projectPath });
                if (stdout?.trim()) {
                    // It's a valid local branch - check if we have a remote
                    const hasOrigin = await this.hasRemote(projectPath, 'origin');
                    if (hasOrigin) {
                        return {
                            remote: 'origin',
                            branch: settings.baseRef,
                            fullRef: `origin/${settings.baseRef}`,
                        };
                    }
                    else {
                        // Local-only repo
                        return {
                            remote: '',
                            branch: settings.baseRef,
                            fullRef: settings.baseRef,
                        };
                    }
                }
            }
            catch {
                // Not a local branch, continue to fallback
            }
        }
        // Check if we have a remote
        const hasOrigin = await this.hasRemote(projectPath, 'origin');
        const fallbackBranch = settings.gitBranch?.trim() && !settings.gitBranch.includes(' ')
            ? settings.gitBranch.trim()
            : await this.getDefaultBranch(projectPath);
        const branch = fallbackBranch || 'main';
        if (hasOrigin) {
            return {
                remote: 'origin',
                branch,
                fullRef: `origin/${branch}`,
            };
        }
        else {
            // Local-only repo
            return {
                remote: '',
                branch,
                fullRef: branch,
            };
        }
    }
    async buildDefaultBaseRef(projectPath) {
        const hasOrigin = await this.hasRemote(projectPath, 'origin');
        const branch = await this.getDefaultBranch(projectPath);
        const cleanBranch = branch?.trim() || 'main';
        if (hasOrigin) {
            return { remote: 'origin', branch: cleanBranch, fullRef: `origin/${cleanBranch}` };
        }
        else {
            // Local-only repo
            return { remote: '', branch: cleanBranch, fullRef: cleanBranch };
        }
    }
    extractErrorMessage(error) {
        if (!error)
            return '';
        const parts = [];
        if (typeof error.message === 'string')
            parts.push(error.message);
        if (typeof error.stderr === 'string')
            parts.push(error.stderr);
        if (typeof error.stdout === 'string')
            parts.push(error.stdout);
        return parts.filter(Boolean).join(' ').trim();
    }
    isMissingRemoteRefError(error) {
        const msg = this.extractErrorMessage(error).toLowerCase();
        if (!msg)
            return false;
        return (msg.includes("couldn't find remote ref") ||
            msg.includes('could not find remote ref') ||
            msg.includes('remote ref does not exist') ||
            msg.includes('fatal: the remote end hung up unexpectedly') ||
            msg.includes('no such ref was fetched'));
    }
    async fetchBaseRefWithFallback(projectPath, projectId, target) {
        // Check if remote exists - if not, this is a local-only repo
        const hasRemote = await this.hasRemote(projectPath, target.remote);
        if (!hasRemote) {
            logger_1.log.info(`No remote '${target.remote}' found, using local branch ${target.branch}`);
            // Verify the local branch exists
            try {
                await execFileAsync('git', ['rev-parse', '--verify', target.branch], {
                    cwd: projectPath,
                });
                // Return target with just the branch name (no remote prefix)
                return {
                    remote: '',
                    branch: target.branch,
                    fullRef: target.branch,
                };
            }
            catch (error) {
                if (error?.code === 'ENAMETOOLONG' ||
                    error?.code === 'ENOENT' ||
                    error?.code === 'EACCES') {
                    throw new Error(`Git failed to run (${error.code}). Check app logs for details.`);
                }
                throw new Error(`Local branch '${target.branch}' does not exist. Please create it first.`);
            }
        }
        // Remote exists, proceed with fetch
        try {
            await execFileAsync('git', ['fetch', target.remote, target.branch], {
                cwd: projectPath,
            });
            logger_1.log.info(`Fetched latest ${target.fullRef} for worktree creation`);
            return target;
        }
        catch (error) {
            logger_1.log.warn(`Failed to fetch ${target.fullRef}`, error);
            if (!this.isMissingRemoteRefError(error)) {
                const message = this.extractErrorMessage(error) || 'Unknown git fetch error';
                throw new Error(`Failed to fetch ${target.fullRef}: ${message}`);
            }
            // Attempt fallback to default branch
            const fallback = await this.buildDefaultBaseRef(projectPath);
            if (fallback.fullRef === target.fullRef) {
                const message = this.extractErrorMessage(error) || 'Unknown git fetch error';
                throw new Error(`Failed to fetch ${target.fullRef}: ${message}`);
            }
            // Check if fallback remote exists before fetching
            const hasFallbackRemote = await this.hasRemote(projectPath, fallback.remote);
            if (!hasFallbackRemote) {
                throw new Error(`Failed to fetch ${target.fullRef} and fallback remote '${fallback.remote}' does not exist`);
            }
            try {
                await execFileAsync('git', ['fetch', fallback.remote, fallback.branch], {
                    cwd: projectPath,
                });
                logger_1.log.info(`Fetched fallback ${fallback.fullRef} after missing base ref`);
                try {
                    await ProjectSettingsService_1.projectSettingsService.updateProjectSettings(projectId, {
                        baseRef: fallback.fullRef,
                    });
                    logger_1.log.info(`Updated project ${projectId} baseRef to fallback ${fallback.fullRef}`);
                }
                catch (persistError) {
                    logger_1.log.warn('Failed to persist fallback baseRef', persistError);
                }
                return fallback;
            }
            catch (fallbackError) {
                const msg = this.extractErrorMessage(fallbackError) || 'Unknown git fetch error';
                throw new Error(`Failed to fetch base branch. Tried ${target.fullRef} and ${fallback.fullRef}. ${msg} Please verify the branch exists on the remote.`);
            }
        }
    }
    /**
     * Check if a git remote exists in the repository
     */
    async hasRemote(projectPath, remoteName) {
        if (!remoteName)
            return false;
        try {
            await execFileAsync('git', ['remote', 'get-url', remoteName], {
                cwd: projectPath,
            });
            return true;
        }
        catch (error) {
            if (error?.code === 'ENAMETOOLONG' || error?.code === 'ENOENT' || error?.code === 'EACCES') {
                throw error;
            }
            return false;
        }
    }
    /**
     * Merge worktree changes back to main branch
     */
    async mergeWorktreeChanges(projectPath, worktreeId) {
        try {
            const worktree = this.worktrees.get(worktreeId);
            if (!worktree) {
                throw new Error('Worktree not found');
            }
            const defaultBranch = await this.getDefaultBranch(projectPath);
            // Switch to default branch
            await execFileAsync('git', ['checkout', defaultBranch], { cwd: projectPath });
            // Merge the worktree branch
            await execFileAsync('git', ['merge', worktree.branch], { cwd: projectPath });
            // Remove the worktree
            await this.removeWorktree(projectPath, worktreeId);
            logger_1.log.info(`Merged worktree changes: ${worktree.name}`);
        }
        catch (error) {
            logger_1.log.error('Failed to merge worktree changes:', error);
            throw new Error(`Failed to merge worktree changes: ${error}`);
        }
    }
    /**
     * Get worktree by ID
     */
    getWorktree(worktreeId) {
        return this.worktrees.get(worktreeId);
    }
    /**
     * Get all worktrees
     */
    getAllWorktrees() {
        return Array.from(this.worktrees.values());
    }
    /**
     * Build scoped git pathspecs from preserve patterns.
     * We query both the raw pattern and a recursive variant to preserve existing
     * basename-matching behavior for nested files.
     */
    buildIgnoredPathspecs(patterns) {
        const pathspecs = new Set();
        for (const rawPattern of patterns) {
            const pattern = rawPattern.trim().replace(/\\/g, '/').replace(/^\.\//, '');
            if (!pattern) {
                continue;
            }
            pathspecs.add(pattern);
            if (!pattern.startsWith('**/')) {
                pathspecs.add(`**/${pattern}`);
            }
        }
        return Array.from(pathspecs);
    }
    /**
     * Get ignored and non-ignored untracked files that match preserve patterns.
     */
    async getPreserveCandidateFiles(dir, patterns) {
        const pathspecs = this.buildIgnoredPathspecs(patterns);
        if (pathspecs.length === 0) {
            return [];
        }
        try {
            const [ignoredResult, untrackedResult] = await Promise.all([
                execFileAsync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--', ...pathspecs], {
                    cwd: dir,
                    maxBuffer: 10 * 1024 * 1024,
                }),
                execFileAsync('git', ['ls-files', '--others', '--exclude-standard', '--', ...pathspecs], {
                    cwd: dir,
                    maxBuffer: 10 * 1024 * 1024,
                }),
            ]);
            const ignoredFiles = (ignoredResult.stdout || '')
                .trim()
                .split('\n')
                .filter((line) => line.length > 0);
            const untrackedFiles = (untrackedResult.stdout || '')
                .trim()
                .split('\n')
                .filter((line) => line.length > 0);
            return Array.from(new Set([...ignoredFiles, ...untrackedFiles]));
        }
        catch (error) {
            logger_1.log.debug('Failed to list preserve candidate files:', error);
            return [];
        }
    }
    /**
     * Check if a file path matches any of the preserve patterns
     */
    matchesPreservePattern(filePath, patterns) {
        const fileName = path_1.default.basename(filePath);
        for (const pattern of patterns) {
            // Match against filename
            if ((0, minimatch_1.minimatch)(fileName, pattern, { dot: true })) {
                return true;
            }
            // Match against full path
            if ((0, minimatch_1.minimatch)(filePath, pattern, { dot: true })) {
                return true;
            }
            // Match against full path with ** prefix for nested matches
            if ((0, minimatch_1.minimatch)(filePath, `**/${pattern}`, { dot: true })) {
                return true;
            }
        }
        return false;
    }
    /**
     * Check if a file path contains any excluded path segments
     */
    isExcludedPath(filePath, excludePatterns) {
        if (excludePatterns.length === 0) {
            return false;
        }
        // git ls-files always returns paths with forward slashes regardless of OS
        const parts = filePath.split('/');
        for (const part of parts) {
            if (excludePatterns.includes(part)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Copy a file safely, skipping if destination already exists
     */
    async copyFileExclusive(sourcePath, destPath) {
        try {
            // Check if destination already exists
            if (fs_1.default.existsSync(destPath)) {
                return 'skipped';
            }
            // Ensure destination directory exists
            const destDir = path_1.default.dirname(destPath);
            if (!fs_1.default.existsSync(destDir)) {
                fs_1.default.mkdirSync(destDir, { recursive: true });
            }
            // Copy file preserving mode
            const content = fs_1.default.readFileSync(sourcePath);
            const stat = fs_1.default.statSync(sourcePath);
            fs_1.default.writeFileSync(destPath, content, { mode: stat.mode });
            return 'copied';
        }
        catch (error) {
            logger_1.log.debug(`Failed to copy ${sourcePath} to ${destPath}:`, error);
            return 'error';
        }
    }
    /**
     * Preserve local files (typically ignored or untracked) from source to destination worktree.
     * Only copies files that match the preserve patterns and don't exist in destination.
     */
    async preserveFilesToWorktree(sourceDir, destDir, patterns = DEFAULT_PRESERVE_PATTERNS, excludePatterns = DEFAULT_EXCLUDE_PATTERNS) {
        const result = { copied: [], skipped: [] };
        if (patterns.length === 0) {
            return result;
        }
        // Get local files matching preserve patterns from source directory
        const sourceFiles = await this.getPreserveCandidateFiles(sourceDir, patterns);
        if (sourceFiles.length === 0) {
            logger_1.log.debug('No preserve candidate files found in source directory');
            return result;
        }
        // Filter files that match patterns and aren't excluded
        const filesToCopy = [];
        for (const file of sourceFiles) {
            if (this.isExcludedPath(file, excludePatterns)) {
                continue;
            }
            if (this.matchesPreservePattern(file, patterns)) {
                filesToCopy.push(file);
            }
        }
        if (filesToCopy.length === 0) {
            logger_1.log.debug('No files matched preserve patterns');
            return result;
        }
        logger_1.log.info(`Preserving ${filesToCopy.length} file(s) to worktree: ${filesToCopy.join(', ')}`);
        // Copy each file
        for (const file of filesToCopy) {
            const sourcePath = path_1.default.join(sourceDir, file);
            const destPath = path_1.default.join(destDir, file);
            // Verify source file exists
            if (!fs_1.default.existsSync(sourcePath)) {
                logger_1.log.debug(`Source file does not exist, skipping: ${sourcePath}`);
                continue;
            }
            const copyResult = await this.copyFileExclusive(sourcePath, destPath);
            if (copyResult === 'copied') {
                result.copied.push(file);
                logger_1.log.debug(`Copied: ${file}`);
            }
            else if (copyResult === 'skipped') {
                result.skipped.push(file);
                logger_1.log.debug(`Skipped (already exists): ${file}`);
            }
        }
        if (result.copied.length > 0) {
            logger_1.log.info(`Preserved ${result.copied.length} file(s) to worktree`);
        }
        return result;
    }
    async logWorktreeSyncStatus(projectPath, worktreePath, baseRef) {
        try {
            const [{ stdout: remoteOut }, { stdout: worktreeOut }] = await Promise.all([
                execFileAsync('git', ['rev-parse', baseRef.fullRef], { cwd: projectPath }),
                execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath }),
            ]);
            const remoteSha = (remoteOut || '').trim();
            const worktreeSha = (worktreeOut || '').trim();
            if (!remoteSha || !worktreeSha)
                return;
            if (remoteSha === worktreeSha) {
                logger_1.log.debug(`Worktree ${worktreePath} matches ${baseRef.fullRef} @ ${remoteSha}`);
            }
            else {
                logger_1.log.warn(`Worktree ${worktreePath} diverged from ${baseRef.fullRef} immediately after creation`, { remoteSha, worktreeSha, baseRef: baseRef.fullRef });
            }
        }
        catch (error) {
            logger_1.log.debug('Unable to verify worktree head against remote', error);
        }
    }
    async createWorktreeFromBranch(projectPath, taskName, branchName, projectId, options) {
        const normalizedName = taskName || branchName.replace(/\//g, '-');
        const sluggedName = this.slugify(normalizedName) || 'task';
        const targetPath = options?.worktreePath ||
            path_1.default.join(projectPath, '..', `worktrees/${sluggedName}-${Date.now()}`);
        const worktreePath = path_1.default.resolve(targetPath);
        if (fs_1.default.existsSync(worktreePath)) {
            throw new Error(`Worktree directory already exists: ${worktreePath}`);
        }
        const worktreesDir = path_1.default.dirname(worktreePath);
        if (!fs_1.default.existsSync(worktreesDir)) {
            fs_1.default.mkdirSync(worktreesDir, { recursive: true });
        }
        try {
            await execFileAsync('git', ['worktree', 'add', worktreePath, branchName], {
                cwd: projectPath,
            });
        }
        catch (error) {
            throw new Error(`Failed to create worktree for branch ${branchName}: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!fs_1.default.existsSync(worktreePath)) {
            throw new Error(`Worktree directory was not created: ${worktreePath}`);
        }
        // Preserve .env and other gitignored config files from source to worktree
        try {
            await this.preserveProjectFilesToWorktree(projectPath, worktreePath);
        }
        catch (preserveErr) {
            logger_1.log.warn('Failed to preserve files to worktree (continuing):', preserveErr);
        }
        const worktreeInfo = {
            id: this.stableIdFromPath(worktreePath),
            name: normalizedName,
            branch: branchName,
            path: worktreePath,
            projectId,
            status: 'active',
            createdAt: new Date().toISOString(),
        };
        this.worktrees.set(worktreeInfo.id, worktreeInfo);
        return worktreeInfo;
    }
    /**
     * Register a worktree created externally (e.g., by WorktreePoolService)
     */
    registerWorktree(worktree) {
        this.worktrees.set(worktree.id, worktree);
    }
}
exports.WorktreeService = WorktreeService;
exports.worktreeService = new WorktreeService();
