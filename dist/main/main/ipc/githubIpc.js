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
exports.registerGithubIpc = registerGithubIpc;
const electron_1 = require("electron");
const logger_1 = require("../lib/logger");
const GitHubService_1 = require("../services/GitHubService");
const WorktreeService_1 = require("../services/WorktreeService");
const GitHubCLIInstaller_1 = require("../services/GitHubCLIInstaller");
const DatabaseService_1 = require("../services/DatabaseService");
const child_process_1 = require("child_process");
const util_1 = require("util");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const os_1 = require("os");
const shellEscape_1 = require("../utils/shellEscape");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const githubService = new GitHubService_1.GitHubService();
const slugify = (name) => name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
function registerGithubIpc() {
    electron_1.ipcMain.handle('github:connect', async (_, projectPath) => {
        try {
            // Check if GitHub CLI is authenticated
            const isAuth = await githubService.isAuthenticated();
            if (!isAuth) {
                return { success: false, error: 'GitHub CLI not authenticated' };
            }
            // Get repository info from GitHub CLI
            try {
                const { stdout } = await execAsync('gh repo view --json name,nameWithOwner,defaultBranchRef', { cwd: projectPath });
                const repoInfo = JSON.parse(stdout);
                return {
                    success: true,
                    repository: repoInfo.nameWithOwner,
                    branch: repoInfo.defaultBranchRef?.name || 'main',
                };
            }
            catch (error) {
                return {
                    success: false,
                    error: 'Repository not found on GitHub or not connected to GitHub CLI',
                };
            }
        }
        catch (error) {
            logger_1.log.error('Failed to connect to GitHub:', error);
            return { success: false, error: 'Failed to connect to GitHub' };
        }
    });
    // Start Device Flow authentication with automatic background polling
    electron_1.ipcMain.handle('github:auth', async () => {
        try {
            return await githubService.startDeviceFlowAuth();
        }
        catch (error) {
            logger_1.log.error('GitHub authentication failed:', error);
            return { success: false, error: 'Authentication failed' };
        }
    });
    // Cancel ongoing authentication
    electron_1.ipcMain.handle('github:auth:cancel', async () => {
        try {
            githubService.cancelAuth();
            return { success: true };
        }
        catch (error) {
            logger_1.log.error('Failed to cancel GitHub auth:', error);
            return { success: false, error: 'Failed to cancel' };
        }
    });
    electron_1.ipcMain.handle('github:isAuthenticated', async () => {
        try {
            return await githubService.isAuthenticated();
        }
        catch (error) {
            logger_1.log.error('GitHub authentication check failed:', error);
            return false;
        }
    });
    // GitHub status: installed + authenticated + user
    electron_1.ipcMain.handle('github:getStatus', async () => {
        try {
            let installed = true;
            try {
                await execAsync('gh --version');
            }
            catch {
                installed = false;
            }
            let authenticated = false;
            let user = null;
            if (installed) {
                try {
                    const { stdout } = await execAsync('gh api user');
                    user = JSON.parse(stdout);
                    authenticated = true;
                }
                catch {
                    authenticated = false;
                    user = null;
                }
            }
            return { installed, authenticated, user };
        }
        catch (error) {
            logger_1.log.error('GitHub status check failed:', error);
            return { installed: false, authenticated: false };
        }
    });
    electron_1.ipcMain.handle('github:getUser', async () => {
        try {
            const token = await githubService['getStoredToken']();
            if (!token)
                return null;
            return await githubService.getUserInfo(token);
        }
        catch (error) {
            logger_1.log.error('Failed to get user info:', error);
            return null;
        }
    });
    electron_1.ipcMain.handle('github:getRepositories', async () => {
        try {
            const token = await githubService['getStoredToken']();
            if (!token)
                throw new Error('Not authenticated');
            return await githubService.getRepositories(token);
        }
        catch (error) {
            logger_1.log.error('Failed to get repositories:', error);
            return [];
        }
    });
    electron_1.ipcMain.handle('github:cloneRepository', async (_, repoUrl, localPath) => {
        const q = (s) => JSON.stringify(s);
        try {
            // Opt-out flag for safety or debugging
            if (process.env.EMDASH_DISABLE_CLONE_CACHE === '1') {
                await execAsync(`git clone ${q(repoUrl)} ${q(localPath)}`);
                return { success: true };
            }
            // Ensure parent directory exists
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            // If already a git repo, short‑circuit
            try {
                if (fs.existsSync(path.join(localPath, '.git')))
                    return { success: true };
            }
            catch { }
            // Use a local bare mirror cache keyed by normalized URL
            const cacheRoot = path.join(electron_1.app.getPath('userData'), 'repo-cache');
            if (!fs.existsSync(cacheRoot))
                fs.mkdirSync(cacheRoot, { recursive: true });
            const norm = (u) => u.replace(/\.git$/i, '').trim();
            const cacheKey = require('crypto').createHash('sha1').update(norm(repoUrl)).digest('hex');
            const mirrorPath = path.join(cacheRoot, `${cacheKey}.mirror`);
            if (!fs.existsSync(mirrorPath)) {
                await execAsync(`git clone --mirror --filter=blob:none ${q(repoUrl)} ${q(mirrorPath)}`);
            }
            else {
                try {
                    await execAsync(`git -C ${q(mirrorPath)} remote set-url origin ${q(repoUrl)}`);
                }
                catch { }
                await execAsync(`git -C ${q(mirrorPath)} remote update --prune`);
            }
            await execAsync(`git clone --reference-if-able ${q(mirrorPath)} --dissociate ${q(repoUrl)} ${q(localPath)}`);
            return { success: true };
        }
        catch (error) {
            logger_1.log.error('Failed to clone repository via cache:', error);
            try {
                await execAsync(`git clone ${q(repoUrl)} ${q(localPath)}`);
                return { success: true };
            }
            catch (e2) {
                return { success: false, error: e2 instanceof Error ? e2.message : 'Clone failed' };
            }
        }
    });
    electron_1.ipcMain.handle('github:logout', async () => {
        try {
            await githubService.logout();
            return { success: true };
        }
        catch (error) {
            logger_1.log.error('Failed to logout:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Logout failed' };
        }
    });
    // GitHub issues: list/search/get for the repository at projectPath
    electron_1.ipcMain.handle('github:issues:list', async (_e, projectPath, limit) => {
        if (!projectPath)
            return { success: false, error: 'Project path is required' };
        try {
            const issues = await githubService.listIssues(projectPath, limit ?? 50);
            return { success: true, issues };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to list issues';
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('github:issues:search', async (_e, projectPath, searchTerm, limit) => {
        if (!projectPath)
            return { success: false, error: 'Project path is required' };
        if (!searchTerm || typeof searchTerm !== 'string') {
            return { success: false, error: 'Search term is required' };
        }
        try {
            const issues = await githubService.searchIssues(projectPath, searchTerm, limit ?? 20);
            return { success: true, issues };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to search issues';
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('github:issues:get', async (_e, projectPath, number) => {
        if (!projectPath)
            return { success: false, error: 'Project path is required' };
        if (!number || !Number.isFinite(number)) {
            return { success: false, error: 'Issue number is required' };
        }
        try {
            const issue = await githubService.getIssue(projectPath, number);
            return { success: !!issue, issue: issue ?? undefined };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to get issue';
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('github:listPullRequests', async (_, args) => {
        const projectPath = args?.projectPath;
        if (!projectPath) {
            return { success: false, error: 'Project path is required' };
        }
        try {
            const result = await githubService.getPullRequests(projectPath, args?.limit);
            return { success: true, prs: result.prs, totalCount: result.totalCount };
        }
        catch (error) {
            logger_1.log.error('Failed to list pull requests:', error);
            const message = error instanceof Error ? error.message : 'Unable to list pull requests via GitHub CLI';
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('github:createPullRequestWorktree', async (_, args) => {
        const { projectPath, projectId, prNumber } = args || {};
        if (!projectPath || !projectId || !prNumber) {
            return { success: false, error: 'Missing required parameters' };
        }
        const defaultSlug = slugify(args.prTitle || `pr-${prNumber}`) || `pr-${prNumber}`;
        const taskName = args.taskName && args.taskName.trim().length > 0
            ? args.taskName.trim()
            : `pr-${prNumber}-${defaultSlug}`;
        const branchName = args.branchName || `pr/${prNumber}`;
        const buildTaskInfo = (taskPath, name) => ({
            id: crypto.randomUUID(),
            projectId,
            name,
            branch: branchName,
            path: taskPath,
            status: 'active',
            useWorktree: true,
            metadata: {
                prNumber,
                prTitle: args.prTitle || null,
            },
        });
        try {
            const currentWorktrees = await WorktreeService_1.worktreeService.listWorktrees(projectPath);
            const existing = currentWorktrees.find((wt) => wt.branch === branchName);
            if (existing) {
                const persistedTask = await DatabaseService_1.databaseService.getTaskByPath(existing.path);
                const existingTask = persistedTask ?? buildTaskInfo(existing.path, existing.name);
                if (!persistedTask) {
                    try {
                        await DatabaseService_1.databaseService.saveTask(existingTask);
                    }
                    catch (dbError) {
                        logger_1.log.warn('Failed to save existing PR review task to database:', dbError);
                    }
                }
                return {
                    success: true,
                    worktree: existing,
                    branchName,
                    taskName: existingTask.name,
                    task: existingTask,
                };
            }
            await githubService.ensurePullRequestBranch(projectPath, prNumber, branchName);
            const worktreesDir = path.resolve(projectPath, '..', 'worktrees');
            const slug = slugify(taskName) || `pr-${prNumber}`;
            let worktreePath = path.join(worktreesDir, slug);
            if (fs.existsSync(worktreePath)) {
                worktreePath = path.join(worktreesDir, `${slug}-${Date.now()}`);
            }
            const worktree = await WorktreeService_1.worktreeService.createWorktreeFromBranch(projectPath, taskName, branchName, projectId, { worktreePath });
            // Save a task with PR metadata so the UI can identify it as a PR review task
            const taskInfo = buildTaskInfo(worktree.path, taskName);
            try {
                await DatabaseService_1.databaseService.saveTask(taskInfo);
            }
            catch (dbError) {
                logger_1.log.warn('Failed to save PR review task to database:', dbError);
            }
            return { success: true, worktree, branchName, taskName, task: taskInfo };
        }
        catch (error) {
            logger_1.log.error('Failed to create PR worktree:', error);
            const message = error instanceof Error ? error.message : 'Unable to create PR worktree via GitHub CLI';
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('github:getPullRequestBaseDiff', async (_, args) => {
        const { worktreePath, prNumber } = args || {};
        if (!worktreePath || !prNumber) {
            return { success: false, error: 'Missing required parameters' };
        }
        try {
            // Find the project root from the worktree path
            let projectRoot;
            try {
                const { stdout } = await execAsync('git rev-parse --show-toplevel', {
                    cwd: worktreePath,
                });
                projectRoot = stdout.trim();
            }
            catch {
                projectRoot = worktreePath;
            }
            // Get PR details (base/head branches)
            const prDetails = await githubService.getPullRequestDetails(projectRoot, prNumber);
            if (!prDetails) {
                return { success: false, error: 'Could not fetch PR details' };
            }
            const { baseRefName, headRefName } = prDetails;
            // Fetch the base branch to ensure we have the latest
            try {
                await execAsync(`git fetch origin ${(0, shellEscape_1.quoteShellArg)(baseRefName)}`, { cwd: worktreePath });
            }
            catch {
                // Best effort — base ref may already be available locally
            }
            // Use HEAD as the PR head (the worktree is checked out to the PR branch).
            // This works for both same-repo and fork PRs, since origin/headRefName
            // doesn't exist for fork PRs.
            let diff;
            try {
                // Three-dot diff: changes introduced by the PR relative to the merge base
                const { stdout } = await execAsync(`git diff ${(0, shellEscape_1.quoteShellArg)(`origin/${baseRefName}`)}...HEAD`, { cwd: worktreePath, maxBuffer: 10 * 1024 * 1024 });
                diff = stdout;
            }
            catch {
                // Fallback: two-dot diff
                try {
                    const { stdout } = await execAsync(`git diff ${(0, shellEscape_1.quoteShellArg)(`origin/${baseRefName}`)} HEAD`, { cwd: worktreePath, maxBuffer: 10 * 1024 * 1024 });
                    diff = stdout;
                }
                catch (diffError) {
                    return {
                        success: false,
                        error: diffError instanceof Error ? diffError.message : 'Failed to compute PR diff',
                    };
                }
            }
            return {
                success: true,
                diff,
                baseBranch: baseRefName,
                headBranch: headRefName,
                prUrl: prDetails.url,
            };
        }
        catch (error) {
            logger_1.log.error('Failed to get PR base diff:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get PR diff',
            };
        }
    });
    electron_1.ipcMain.handle('github:checkCLIInstalled', async () => {
        try {
            return await GitHubCLIInstaller_1.githubCLIInstaller.isInstalled();
        }
        catch (error) {
            logger_1.log.error('Failed to check gh CLI installation:', error);
            return false;
        }
    });
    electron_1.ipcMain.handle('github:installCLI', async () => {
        try {
            return await GitHubCLIInstaller_1.githubCLIInstaller.install();
        }
        catch (error) {
            logger_1.log.error('Failed to install gh CLI:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Installation failed',
            };
        }
    });
    electron_1.ipcMain.handle('github:getOwners', async () => {
        try {
            const owners = await githubService.getOwners();
            return { success: true, owners };
        }
        catch (error) {
            logger_1.log.error('Failed to get owners:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get owners',
            };
        }
    });
    electron_1.ipcMain.handle('github:validateRepoName', async (_, name, owner) => {
        try {
            // First validate format
            const formatValidation = githubService.validateRepositoryName(name);
            if (!formatValidation.valid) {
                return {
                    success: true,
                    valid: false,
                    exists: false,
                    error: formatValidation.error,
                };
            }
            // Then check if it exists
            const exists = await githubService.checkRepositoryExists(owner, name);
            if (exists) {
                return {
                    success: true,
                    valid: true,
                    exists: true,
                    error: `Repository ${owner}/${name} already exists`,
                };
            }
            return {
                success: true,
                valid: true,
                exists: false,
            };
        }
        catch (error) {
            logger_1.log.error('Failed to validate repo name:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Validation failed',
            };
        }
    });
    electron_1.ipcMain.handle('github:createNewProject', async (_, params) => {
        let githubRepoCreated = false;
        let localDirCreated = false;
        let repoUrl;
        let localPath;
        try {
            const { name, description, owner, isPrivate, gitignoreTemplate } = params;
            // Validate inputs
            const formatValidation = githubService.validateRepositoryName(name);
            if (!formatValidation.valid) {
                return {
                    success: false,
                    error: formatValidation.error || 'Invalid repository name',
                };
            }
            // Check if repo already exists
            const exists = await githubService.checkRepositoryExists(owner, name);
            if (exists) {
                return {
                    success: false,
                    error: `Repository ${owner}/${name} already exists`,
                };
            }
            // Get project directory from settings
            const { getAppSettings } = await Promise.resolve().then(() => __importStar(require('../settings')));
            const settings = getAppSettings();
            const projectDir = settings.projects?.defaultDirectory || path.join((0, os_1.homedir)(), 'emdash-projects');
            // Ensure project directory exists
            if (!fs.existsSync(projectDir)) {
                fs.mkdirSync(projectDir, { recursive: true });
            }
            localPath = path.join(projectDir, name);
            if (fs.existsSync(localPath)) {
                return {
                    success: false,
                    error: `Directory ${localPath} already exists`,
                };
            }
            // Create GitHub repository
            const repoInfo = await githubService.createRepository({
                name,
                description,
                owner,
                isPrivate,
            });
            githubRepoCreated = true;
            repoUrl = repoInfo.url;
            // Clone repository
            const cloneResult = await githubService.cloneRepository(repoUrl, localPath);
            if (!cloneResult.success) {
                // Cleanup: delete GitHub repo on clone failure
                try {
                    // Security: Use quoteShellArg to prevent command injection
                    const repoRef = `${(0, shellEscape_1.quoteShellArg)(owner)}/${(0, shellEscape_1.quoteShellArg)(name)}`;
                    await execAsync(`gh repo delete ${repoRef} --yes`, {
                        timeout: 10000,
                    });
                }
                catch (cleanupError) {
                    logger_1.log.warn('Failed to cleanup GitHub repo after clone failure:', cleanupError);
                }
                return {
                    success: false,
                    error: cloneResult.error || 'Failed to clone repository',
                };
            }
            localDirCreated = true;
            // Initialize project (create README, commit, push)
            await githubService.initializeNewProject({
                repoUrl,
                localPath,
                name,
                description,
            });
            // TODO: Add .gitignore if template specified (for future enhancement)
            return {
                success: true,
                projectPath: localPath,
                repoUrl,
                fullName: repoInfo.fullName,
                defaultBranch: repoInfo.defaultBranch,
            };
        }
        catch (error) {
            logger_1.log.error('Failed to create new project:', error);
            // Cleanup on failure
            if (localDirCreated && localPath && fs.existsSync(localPath)) {
                try {
                    fs.rmSync(localPath, { recursive: true, force: true });
                }
                catch (cleanupError) {
                    logger_1.log.warn('Failed to cleanup local directory:', cleanupError);
                }
            }
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to create project',
                githubRepoCreated, // Inform frontend about orphaned repo
                repoUrl,
            };
        }
    });
}
