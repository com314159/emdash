"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseController = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const DatabaseService_1 = require("../services/DatabaseService");
const rpc_1 = require("../../shared/ipc/rpc");
const logger_1 = require("../lib/logger");
exports.databaseController = (0, rpc_1.createRPCController)({
    getProjects: () => DatabaseService_1.databaseService.getProjects(),
    saveProject: (project) => DatabaseService_1.databaseService.saveProject(project),
    getTasks: (projectId) => DatabaseService_1.databaseService.getTasks(projectId),
    saveTask: (task) => DatabaseService_1.databaseService.saveTask(task),
    deleteProject: (projectId) => DatabaseService_1.databaseService.deleteProject(projectId),
    deleteTask: (taskId) => DatabaseService_1.databaseService.deleteTask(taskId),
    archiveTask: (taskId) => DatabaseService_1.databaseService.archiveTask(taskId),
    restoreTask: (taskId) => DatabaseService_1.databaseService.restoreTask(taskId),
    getArchivedTasks: (projectId) => DatabaseService_1.databaseService.getArchivedTasks(projectId),
    saveConversation: (conversation) => DatabaseService_1.databaseService.saveConversation(conversation),
    getConversations: (taskId) => DatabaseService_1.databaseService.getConversations(taskId),
    getOrCreateDefaultConversation: (args) => DatabaseService_1.databaseService.getOrCreateDefaultConversation(args.taskId, args.provider),
    createConversation: (args) => DatabaseService_1.databaseService.createConversation(args.taskId, args.title, args.provider, args.isMain),
    deleteConversation: (conversationId) => DatabaseService_1.databaseService.deleteConversation(conversationId),
    setActiveConversation: (args) => DatabaseService_1.databaseService.setActiveConversation(args.taskId, args.conversationId),
    getActiveConversation: (taskId) => DatabaseService_1.databaseService.getActiveConversation(taskId),
    reorderConversations: (args) => DatabaseService_1.databaseService.reorderConversations(args.taskId, args.conversationIds),
    updateConversationTitle: (args) => DatabaseService_1.databaseService.updateConversationTitle(args.conversationId, args.title),
    saveMessage: (message) => DatabaseService_1.databaseService.saveMessage(message),
    getMessages: (conversationId) => DatabaseService_1.databaseService.getMessages(conversationId),
    cleanupSessionDirectory: async (args) => {
        const sessionDir = node_path_1.default.join(args.taskPath, '.emdash-sessions', args.conversationId);
        if (!node_fs_1.default.existsSync(sessionDir))
            return;
        node_fs_1.default.rmSync(sessionDir, { recursive: true, force: true });
        logger_1.log.info('Cleaned up session directory:', sessionDir);
        const parentDir = node_path_1.default.join(args.taskPath, '.emdash-sessions');
        try {
            if (node_fs_1.default.readdirSync(parentDir).length === 0) {
                node_fs_1.default.rmdirSync(parentDir);
                logger_1.log.info('Removed empty .emdash-sessions directory');
            }
        }
        catch {
            // Parent directory removal is best-effort
        }
    },
});
