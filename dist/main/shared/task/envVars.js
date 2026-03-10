"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTaskEnvVars = getTaskEnvVars;
function getTaskEnvVars(ctx) {
    const taskName = slugify(ctx.taskName) || 'task';
    const portSeed = ctx.portSeed || ctx.taskPath || ctx.taskId;
    return {
        EMDASH_TASK_ID: ctx.taskId,
        EMDASH_TASK_NAME: taskName,
        EMDASH_TASK_PATH: ctx.taskPath,
        EMDASH_ROOT_PATH: ctx.projectPath,
        EMDASH_DEFAULT_BRANCH: ctx.defaultBranch || 'main',
        EMDASH_PORT: String(getBasePort(portSeed)),
    };
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}
function getBasePort(seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
        hash = (hash << 5) - hash + seed.charCodeAt(i);
        hash |= 0;
    }
    return 50000 + (Math.abs(hash) % 1000) * 10;
}
