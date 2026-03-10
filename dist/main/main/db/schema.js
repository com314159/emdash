"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lineCommentsRelations = exports.messagesRelations = exports.conversationsRelations = exports.tasksRelations = exports.projectsRelations = exports.sshConnectionsRelations = exports.lineComments = exports.messages = exports.conversations = exports.tasks = exports.projects = exports.sshConnections = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const sqlite_core_1 = require("drizzle-orm/sqlite-core");
exports.sshConnections = (0, sqlite_core_1.sqliteTable)('ssh_connections', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    name: (0, sqlite_core_1.text)('name').notNull(),
    host: (0, sqlite_core_1.text)('host').notNull(),
    port: (0, sqlite_core_1.integer)('port').notNull().default(22),
    username: (0, sqlite_core_1.text)('username').notNull(),
    authType: (0, sqlite_core_1.text)('auth_type').notNull().default('agent'), // 'password' | 'key' | 'agent'
    privateKeyPath: (0, sqlite_core_1.text)('private_key_path'), // optional, for key auth
    useAgent: (0, sqlite_core_1.integer)('use_agent').notNull().default(0), // boolean, 0=false, 1=true
    createdAt: (0, sqlite_core_1.text)('created_at')
        .notNull()
        .default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    updatedAt: (0, sqlite_core_1.text)('updated_at')
        .notNull()
        .default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
}, (table) => ({
    nameIdx: (0, sqlite_core_1.uniqueIndex)('idx_ssh_connections_name').on(table.name),
    hostIdx: (0, sqlite_core_1.index)('idx_ssh_connections_host').on(table.host),
}));
exports.projects = (0, sqlite_core_1.sqliteTable)('projects', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    name: (0, sqlite_core_1.text)('name').notNull(),
    path: (0, sqlite_core_1.text)('path').notNull(),
    gitRemote: (0, sqlite_core_1.text)('git_remote'),
    gitBranch: (0, sqlite_core_1.text)('git_branch'),
    baseRef: (0, sqlite_core_1.text)('base_ref'),
    githubRepository: (0, sqlite_core_1.text)('github_repository'),
    githubConnected: (0, sqlite_core_1.integer)('github_connected').notNull().default(0),
    sshConnectionId: (0, sqlite_core_1.text)('ssh_connection_id').references(() => exports.sshConnections.id, {
        onDelete: 'set null',
    }),
    isRemote: (0, sqlite_core_1.integer)('is_remote').notNull().default(0), // boolean, 0=false, 1=true
    remotePath: (0, sqlite_core_1.text)('remote_path'), // path on remote server
    createdAt: (0, sqlite_core_1.text)('created_at')
        .notNull()
        .default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    updatedAt: (0, sqlite_core_1.text)('updated_at')
        .notNull()
        .default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
}, (table) => ({
    pathIdx: (0, sqlite_core_1.uniqueIndex)('idx_projects_path').on(table.path),
    sshConnectionIdIdx: (0, sqlite_core_1.index)('idx_projects_ssh_connection_id').on(table.sshConnectionId),
    isRemoteIdx: (0, sqlite_core_1.index)('idx_projects_is_remote').on(table.isRemote),
}));
exports.tasks = (0, sqlite_core_1.sqliteTable)('tasks', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    projectId: (0, sqlite_core_1.text)('project_id')
        .notNull()
        .references(() => exports.projects.id, { onDelete: 'cascade' }),
    name: (0, sqlite_core_1.text)('name').notNull(),
    branch: (0, sqlite_core_1.text)('branch').notNull(),
    path: (0, sqlite_core_1.text)('path').notNull(),
    status: (0, sqlite_core_1.text)('status').notNull().default('idle'),
    agentId: (0, sqlite_core_1.text)('agent_id'),
    metadata: (0, sqlite_core_1.text)('metadata'),
    useWorktree: (0, sqlite_core_1.integer)('use_worktree').notNull().default(1),
    archivedAt: (0, sqlite_core_1.text)('archived_at'), // null = active, timestamp = archived
    createdAt: (0, sqlite_core_1.text)('created_at')
        .notNull()
        .default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    updatedAt: (0, sqlite_core_1.text)('updated_at')
        .notNull()
        .default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
}, (table) => ({
    projectIdIdx: (0, sqlite_core_1.index)('idx_tasks_project_id').on(table.projectId),
}));
exports.conversations = (0, sqlite_core_1.sqliteTable)('conversations', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    taskId: (0, sqlite_core_1.text)('task_id')
        .notNull()
        .references(() => exports.tasks.id, { onDelete: 'cascade' }),
    title: (0, sqlite_core_1.text)('title').notNull(),
    provider: (0, sqlite_core_1.text)('provider'), // AI provider for this chat (claude, codex, qwen, etc.)
    isActive: (0, sqlite_core_1.integer)('is_active').notNull().default(0), // 1 if this is the active chat for the task
    isMain: (0, sqlite_core_1.integer)('is_main').notNull().default(0), // 1 if this is the main/primary chat (gets full persistence)
    displayOrder: (0, sqlite_core_1.integer)('display_order').notNull().default(0), // Order in the tab bar
    metadata: (0, sqlite_core_1.text)('metadata'), // JSON for additional chat-specific data
    createdAt: (0, sqlite_core_1.text)('created_at')
        .notNull()
        .default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    updatedAt: (0, sqlite_core_1.text)('updated_at')
        .notNull()
        .default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
}, (table) => ({
    taskIdIdx: (0, sqlite_core_1.index)('idx_conversations_task_id').on(table.taskId),
    activeIdx: (0, sqlite_core_1.index)('idx_conversations_active').on(table.taskId, table.isActive), // Index for quick active conversation lookup
}));
exports.messages = (0, sqlite_core_1.sqliteTable)('messages', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    conversationId: (0, sqlite_core_1.text)('conversation_id')
        .notNull()
        .references(() => exports.conversations.id, { onDelete: 'cascade' }),
    content: (0, sqlite_core_1.text)('content').notNull(),
    sender: (0, sqlite_core_1.text)('sender').notNull(),
    timestamp: (0, sqlite_core_1.text)('timestamp')
        .notNull()
        .default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    metadata: (0, sqlite_core_1.text)('metadata'),
}, (table) => ({
    conversationIdIdx: (0, sqlite_core_1.index)('idx_messages_conversation_id').on(table.conversationId),
    timestampIdx: (0, sqlite_core_1.index)('idx_messages_timestamp').on(table.timestamp),
}));
exports.lineComments = (0, sqlite_core_1.sqliteTable)('line_comments', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    taskId: (0, sqlite_core_1.text)('task_id')
        .notNull()
        .references(() => exports.tasks.id, { onDelete: 'cascade' }),
    filePath: (0, sqlite_core_1.text)('file_path').notNull(),
    lineNumber: (0, sqlite_core_1.integer)('line_number').notNull(),
    lineContent: (0, sqlite_core_1.text)('line_content'),
    content: (0, sqlite_core_1.text)('content').notNull(),
    createdAt: (0, sqlite_core_1.text)('created_at')
        .notNull()
        .default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    updatedAt: (0, sqlite_core_1.text)('updated_at')
        .notNull()
        .default((0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`),
    sentAt: (0, sqlite_core_1.text)('sent_at'), // NULL = unsent, timestamp = when injected to chat
}, (table) => ({
    taskFileIdx: (0, sqlite_core_1.index)('idx_line_comments_task_file').on(table.taskId, table.filePath),
}));
exports.sshConnectionsRelations = (0, drizzle_orm_1.relations)(exports.sshConnections, ({ many }) => ({
    projects: many(exports.projects),
}));
exports.projectsRelations = (0, drizzle_orm_1.relations)(exports.projects, ({ one, many }) => ({
    tasks: many(exports.tasks),
    sshConnection: one(exports.sshConnections, {
        fields: [exports.projects.sshConnectionId],
        references: [exports.sshConnections.id],
    }),
}));
exports.tasksRelations = (0, drizzle_orm_1.relations)(exports.tasks, ({ one, many }) => ({
    project: one(exports.projects, {
        fields: [exports.tasks.projectId],
        references: [exports.projects.id],
    }),
    conversations: many(exports.conversations),
    lineComments: many(exports.lineComments),
}));
exports.conversationsRelations = (0, drizzle_orm_1.relations)(exports.conversations, ({ one, many }) => ({
    task: one(exports.tasks, {
        fields: [exports.conversations.taskId],
        references: [exports.tasks.id],
    }),
    messages: many(exports.messages),
}));
exports.messagesRelations = (0, drizzle_orm_1.relations)(exports.messages, ({ one }) => ({
    conversation: one(exports.conversations, {
        fields: [exports.messages.conversationId],
        references: [exports.conversations.id],
    }),
}));
exports.lineCommentsRelations = (0, drizzle_orm_1.relations)(exports.lineComments, ({ one }) => ({
    task: one(exports.tasks, {
        fields: [exports.lineComments.taskId],
        references: [exports.tasks.id],
    }),
}));
