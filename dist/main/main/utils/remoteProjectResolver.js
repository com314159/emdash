"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRemoteProject = isRemoteProject;
exports.resolveRemoteProjectForWorktreePath = resolveRemoteProjectForWorktreePath;
const DatabaseService_1 = require("../services/DatabaseService");
function isRemoteProject(project) {
    return !!(project &&
        project.isRemote &&
        typeof project.sshConnectionId === 'string' &&
        project.sshConnectionId.length > 0 &&
        typeof project.remotePath === 'string' &&
        project.remotePath.length > 0);
}
async function resolveRemoteProjectForWorktreePath(worktreePath) {
    const all = await DatabaseService_1.databaseService.getProjects();
    // Pick the longest matching remotePath prefix.
    const candidates = all
        .filter((p) => isRemoteProject(p))
        .filter((p) => worktreePath.startsWith(p.remotePath.replace(/\/+$/g, '') + '/'))
        .sort((a, b) => b.remotePath.length - a.remotePath.length);
    return candidates[0] ?? null;
}
