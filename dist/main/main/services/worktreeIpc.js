"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorktreeIpc = registerWorktreeIpc;
const electron_1 = require("electron");
const WorktreeService_1 = require("./WorktreeService");
const WorktreePoolService_1 = require("./WorktreePoolService");
const DatabaseService_1 = require("./DatabaseService");
const drizzleClient_1 = require("../db/drizzleClient");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const crypto_1 = __importDefault(require("crypto"));
const RemoteGitService_1 = require("./RemoteGitService");
const SshService_1 = require("./ssh/SshService");
const logger_1 = require("../lib/logger");
const shellEscape_1 = require("../utils/shellEscape");
const remoteProjectResolver_1 = require("../utils/remoteProjectResolver");
const remoteGitService = new RemoteGitService_1.RemoteGitService(SshService_1.sshService);
function stableIdFromRemotePath(worktreePath) {
    const h = crypto_1.default.createHash('sha1').update(worktreePath).digest('hex').slice(0, 12);
    return `wt-${h}`;
}
async function resolveProjectByIdOrPath(args) {
    if (args.projectId) {
        return DatabaseService_1.databaseService.getProjectById(args.projectId);
    }
    if (args.projectPath) {
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const rows = await db
            .select({ id: schema_1.projects.id })
            .from(schema_1.projects)
            .where((0, drizzle_orm_1.eq)(schema_1.projects.path, args.projectPath))
            .limit(1);
        if (rows.length > 0) {
            return DatabaseService_1.databaseService.getProjectById(rows[0].id);
        }
    }
    return null;
}
// isRemoteProject and resolveRemoteProjectForWorktreePath imported from ../utils/remoteProjectResolver
function registerWorktreeIpc() {
    // Create a new worktree
    electron_1.ipcMain.handle('worktree:create', async (event, args) => {
        try {
            const project = await resolveProjectByIdOrPath({
                projectId: args.projectId,
                projectPath: args.projectPath,
            });
            if ((0, remoteProjectResolver_1.isRemoteProject)(project)) {
                const baseRef = args.baseRef ?? project.gitInfo.baseRef;
                logger_1.log.info('worktree:create (remote)', {
                    projectId: project.id,
                    remotePath: project.remotePath,
                });
                const remote = await remoteGitService.createWorktree(project.sshConnectionId, project.remotePath, args.taskName, baseRef);
                const worktree = {
                    id: stableIdFromRemotePath(remote.path),
                    name: args.taskName,
                    branch: remote.branch,
                    path: remote.path,
                    projectId: project.id,
                    status: 'active',
                    createdAt: new Date().toISOString(),
                };
                return { success: true, worktree };
            }
            const worktree = await WorktreeService_1.worktreeService.createWorktree(args.projectPath, args.taskName, args.projectId, args.baseRef);
            return { success: true, worktree };
        }
        catch (error) {
            console.error('Failed to create worktree:', error);
            return { success: false, error: error.message };
        }
    });
    // List worktrees for a project
    electron_1.ipcMain.handle('worktree:list', async (event, args) => {
        try {
            const project = await resolveProjectByIdOrPath({ projectPath: args.projectPath });
            if ((0, remoteProjectResolver_1.isRemoteProject)(project)) {
                const remoteWorktrees = await remoteGitService.listWorktrees(project.sshConnectionId, project.remotePath);
                const worktrees = remoteWorktrees.map((wt) => {
                    const name = wt.path.split('/').filter(Boolean).pop() || wt.path;
                    return {
                        id: stableIdFromRemotePath(wt.path),
                        name,
                        branch: wt.branch,
                        path: wt.path,
                        projectId: project.id,
                        status: 'active',
                        createdAt: new Date().toISOString(),
                    };
                });
                return { success: true, worktrees };
            }
            const worktrees = await WorktreeService_1.worktreeService.listWorktrees(args.projectPath);
            return { success: true, worktrees };
        }
        catch (error) {
            console.error('Failed to list worktrees:', error);
            return { success: false, error: error.message };
        }
    });
    // Remove a worktree
    electron_1.ipcMain.handle('worktree:remove', async (event, args) => {
        try {
            const project = await resolveProjectByIdOrPath({ projectPath: args.projectPath });
            if ((0, remoteProjectResolver_1.isRemoteProject)(project)) {
                const pathToRemove = args.worktreePath;
                if (!pathToRemove) {
                    throw new Error('worktreePath is required for remote worktree removal');
                }
                logger_1.log.info('worktree:remove (remote)', {
                    projectId: project.id,
                    remotePath: project.remotePath,
                    worktreePath: pathToRemove,
                });
                await remoteGitService.removeWorktree(project.sshConnectionId, project.remotePath, pathToRemove);
                // Best-effort prune to clear stale metadata.
                try {
                    await SshService_1.sshService.executeCommand(project.sshConnectionId, 'git worktree prune --verbose', project.remotePath);
                }
                catch { }
                if (args.branch) {
                    try {
                        await SshService_1.sshService.executeCommand(project.sshConnectionId, `git branch -D ${(0, shellEscape_1.quoteShellArg)(args.branch)}`, project.remotePath);
                    }
                    catch { }
                }
                return { success: true };
            }
            await WorktreeService_1.worktreeService.removeWorktree(args.projectPath, args.worktreeId, args.worktreePath, args.branch);
            return { success: true };
        }
        catch (error) {
            console.error('Failed to remove worktree:', error);
            return { success: false, error: error.message };
        }
    });
    // Get worktree status
    electron_1.ipcMain.handle('worktree:status', async (event, args) => {
        try {
            const remoteProject = await (0, remoteProjectResolver_1.resolveRemoteProjectForWorktreePath)(args.worktreePath);
            if (remoteProject) {
                const status = await remoteGitService.getWorktreeStatus(remoteProject.sshConnectionId, args.worktreePath);
                return { success: true, status };
            }
            const status = await WorktreeService_1.worktreeService.getWorktreeStatus(args.worktreePath);
            return { success: true, status };
        }
        catch (error) {
            console.error('Failed to get worktree status:', error);
            return { success: false, error: error.message };
        }
    });
    // Merge worktree changes
    electron_1.ipcMain.handle('worktree:merge', async (event, args) => {
        try {
            const project = await resolveProjectByIdOrPath({ projectPath: args.projectPath });
            if ((0, remoteProjectResolver_1.isRemoteProject)(project)) {
                return { success: false, error: 'Remote worktree merge is not supported yet' };
            }
            await WorktreeService_1.worktreeService.mergeWorktreeChanges(args.projectPath, args.worktreeId);
            return { success: true };
        }
        catch (error) {
            console.error('Failed to merge worktree changes:', error);
            return { success: false, error: error.message };
        }
    });
    // Get worktree by ID
    electron_1.ipcMain.handle('worktree:get', async (event, args) => {
        try {
            const worktree = WorktreeService_1.worktreeService.getWorktree(args.worktreeId);
            return { success: true, worktree };
        }
        catch (error) {
            console.error('Failed to get worktree:', error);
            return { success: false, error: error.message };
        }
    });
    // Get all worktrees
    electron_1.ipcMain.handle('worktree:getAll', async () => {
        try {
            const worktrees = WorktreeService_1.worktreeService.getAllWorktrees();
            return { success: true, worktrees };
        }
        catch (error) {
            console.error('Failed to get all worktrees:', error);
            return { success: false, error: error.message };
        }
    });
    // Ensure a reserve worktree exists for a project (background operation)
    electron_1.ipcMain.handle('worktree:ensureReserve', async (event, args) => {
        try {
            const project = await resolveProjectByIdOrPath({
                projectId: args.projectId,
                projectPath: args.projectPath,
            });
            if ((0, remoteProjectResolver_1.isRemoteProject)(project)) {
                // Remote worktree pooling is not supported (avoid local mkdir on remote paths).
                return { success: true };
            }
            // Fire and forget - don't await, just start the process
            WorktreePoolService_1.worktreePoolService.ensureReserve(args.projectId, args.projectPath, args.baseRef);
            return { success: true };
        }
        catch (error) {
            console.error('Failed to ensure reserve:', error);
            return { success: false, error: error.message };
        }
    });
    // Check if a reserve is available for a project
    electron_1.ipcMain.handle('worktree:hasReserve', async (event, args) => {
        try {
            const project = await resolveProjectByIdOrPath({ projectId: args.projectId });
            if ((0, remoteProjectResolver_1.isRemoteProject)(project)) {
                return { success: true, hasReserve: false };
            }
            const hasReserve = WorktreePoolService_1.worktreePoolService.hasReserve(args.projectId);
            return { success: true, hasReserve };
        }
        catch (error) {
            console.error('Failed to check reserve:', error);
            return { success: false, error: error.message };
        }
    });
    // Claim a reserve worktree for a new task (instant operation)
    electron_1.ipcMain.handle('worktree:claimReserve', async (event, args) => {
        try {
            const project = await resolveProjectByIdOrPath({
                projectId: args.projectId,
                projectPath: args.projectPath,
            });
            if ((0, remoteProjectResolver_1.isRemoteProject)(project)) {
                return { success: false, error: 'Remote worktree pooling is not supported yet' };
            }
            const result = await WorktreePoolService_1.worktreePoolService.claimReserve(args.projectId, args.projectPath, args.taskName, args.baseRef);
            if (result) {
                return {
                    success: true,
                    worktree: result.worktree,
                    needsBaseRefSwitch: result.needsBaseRefSwitch,
                };
            }
            return { success: false, error: 'No reserve available' };
        }
        catch (error) {
            console.error('Failed to claim reserve:', error);
            return { success: false, error: error.message };
        }
    });
    // Claim a reserve and persist the task in one IPC round-trip.
    electron_1.ipcMain.handle('worktree:claimReserveAndSaveTask', async (event, args) => {
        try {
            const project = await resolveProjectByIdOrPath({
                projectId: args.projectId,
                projectPath: args.projectPath,
            });
            if ((0, remoteProjectResolver_1.isRemoteProject)(project)) {
                return { success: false, error: 'Remote worktree pooling is not supported yet' };
            }
            const claim = await WorktreePoolService_1.worktreePoolService.claimReserve(args.projectId, args.projectPath, args.taskName, args.baseRef);
            if (!claim) {
                return { success: false, error: 'No reserve available' };
            }
            const persistedTask = {
                id: claim.worktree.id,
                projectId: args.projectId,
                name: args.taskName,
                branch: claim.worktree.branch,
                path: claim.worktree.path,
                status: args.task.status,
                agentId: args.task.agentId ?? null,
                metadata: args.task.metadata ?? null,
                useWorktree: args.task.useWorktree !== false,
            };
            await DatabaseService_1.databaseService.saveTask(persistedTask);
            return {
                success: true,
                worktree: claim.worktree,
                task: persistedTask,
                needsBaseRefSwitch: claim.needsBaseRefSwitch,
            };
        }
        catch (error) {
            console.error('Failed to claim reserve and save task:', error);
            return { success: false, error: error.message };
        }
    });
    // Remove reserve for a project (cleanup)
    electron_1.ipcMain.handle('worktree:removeReserve', async (event, args) => {
        try {
            if (args.isRemote) {
                return { success: true };
            }
            let projectPath = args.projectPath;
            if (!projectPath) {
                const project = await resolveProjectByIdOrPath({ projectId: args.projectId });
                if (!project) {
                    await WorktreePoolService_1.worktreePoolService.removeReserve(args.projectId);
                    return { success: true };
                }
                if ((0, remoteProjectResolver_1.isRemoteProject)(project)) {
                    return { success: true };
                }
                projectPath = project.path;
            }
            await WorktreePoolService_1.worktreePoolService.removeReserve(args.projectId, projectPath);
            return { success: true };
        }
        catch (error) {
            console.error('Failed to remove reserve:', error);
            return { success: false, error: error.message };
        }
    });
}
