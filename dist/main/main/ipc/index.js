"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rpcRouter = void 0;
exports.registerAllIpc = registerAllIpc;
const ptyIpc_1 = require("../services/ptyIpc");
const worktreeIpc_1 = require("../services/worktreeIpc");
const fsIpc_1 = require("../services/fsIpc");
const lifecycleIpc_1 = require("../services/lifecycleIpc");
const appIpc_1 = require("./appIpc");
const projectIpc_1 = require("./projectIpc");
const projectSettingsIpc_1 = require("./projectSettingsIpc");
const githubIpc_1 = require("./githubIpc");
const dbIpc_1 = require("./dbIpc");
const debugIpc_1 = require("./debugIpc");
const gitIpc_1 = require("./gitIpc");
const linearIpc_1 = require("./linearIpc");
const connectionsIpc_1 = require("./connectionsIpc");
const updateIpc_1 = require("../services/updateIpc");
const telemetryIpc_1 = require("./telemetryIpc");
const jiraIpc_1 = require("./jiraIpc");
const planLockIpc_1 = require("../services/planLockIpc");
const settingsIpc_1 = require("./settingsIpc");
const hostPreviewIpc_1 = require("./hostPreviewIpc");
const browserIpc_1 = require("./browserIpc");
const netIpc_1 = require("./netIpc");
const sshIpc_1 = require("./sshIpc");
const skillsIpc_1 = require("./skillsIpc");
const mcpIpc_1 = require("./mcpIpc");
const rpc_1 = require("../../shared/ipc/rpc");
const electron_1 = require("electron");
const gitlabIpc_1 = require("./gitlabIpc");
const plainIpc_1 = require("./plainIpc");
const forgejoIpc_1 = require("./forgejoIpc");
exports.rpcRouter = (0, rpc_1.createRPCRouter)({
    db: dbIpc_1.databaseController,
    appSettings: settingsIpc_1.appSettingsController,
});
function registerAllIpc() {
    // Register RPC
    (0, rpc_1.registerRPCRouter)(exports.rpcRouter, electron_1.ipcMain);
    // Core app/utility IPC
    (0, appIpc_1.registerAppIpc)();
    (0, debugIpc_1.registerDebugIpc)();
    (0, telemetryIpc_1.registerTelemetryIpc)();
    (0, updateIpc_1.registerUpdateIpc)();
    // Domain IPC
    (0, projectIpc_1.registerProjectIpc)();
    (0, projectSettingsIpc_1.registerProjectSettingsIpc)();
    (0, githubIpc_1.registerGithubIpc)();
    (0, gitIpc_1.registerGitIpc)();
    (0, hostPreviewIpc_1.registerHostPreviewIpc)();
    (0, browserIpc_1.registerBrowserIpc)();
    (0, netIpc_1.registerNetIpc)();
    // Existing modules
    (0, ptyIpc_1.registerPtyIpc)();
    (0, worktreeIpc_1.registerWorktreeIpc)();
    (0, fsIpc_1.registerFsIpc)();
    (0, lifecycleIpc_1.registerLifecycleIpc)();
    (0, linearIpc_1.registerLinearIpc)();
    (0, connectionsIpc_1.registerConnectionsIpc)();
    (0, jiraIpc_1.registerJiraIpc)();
    (0, planLockIpc_1.registerPlanLockIpc)();
    (0, sshIpc_1.registerSshIpc)();
    (0, skillsIpc_1.registerSkillsIpc)();
    (0, mcpIpc_1.registerMcpIpc)();
    (0, gitlabIpc_1.registerGitlabIpc)();
    (0, plainIpc_1.registerPlainIpc)();
    (0, forgejoIpc_1.registerForgejoIpc)();
}
