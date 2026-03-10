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
exports.databaseService = exports.DatabaseService = exports.DatabaseSchemaMismatchError = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const migrator_1 = require("drizzle-orm/migrator");
const path_1 = require("../db/path");
const drizzleClient_1 = require("../db/drizzleClient");
const errorTracking_1 = require("../errorTracking");
const schema_1 = require("../db/schema");
class DatabaseSchemaMismatchError extends Error {
    constructor(dbPath, missingInvariants) {
        const suffix = missingInvariants.length > 0 ? ` (${missingInvariants.join(', ')})` : '';
        super(`Database schema mismatch${suffix}`);
        this.code = 'DB_SCHEMA_MISMATCH';
        this.name = 'DatabaseSchemaMismatchError';
        this.dbPath = dbPath;
        this.missingInvariants = missingInvariants;
    }
}
exports.DatabaseSchemaMismatchError = DatabaseSchemaMismatchError;
class DatabaseService {
    constructor() {
        this.db = null;
        this.sqlite3 = null;
        this.disabled = false;
        this.lastMigrationSummary = null;
        if (process.env.EMDASH_DISABLE_NATIVE_DB === '1') {
            this.disabled = true;
        }
        this.dbPath = (0, path_1.resolveDatabasePath)();
    }
    async initialize() {
        if (this.disabled)
            return Promise.resolve();
        if (!this.sqlite3) {
            try {
                // Dynamic import to avoid loading native module at startup
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                this.sqlite3 = (await Promise.resolve().then(() => __importStar(require('sqlite3'))));
            }
            catch (e) {
                // Track critical database initialization error
                await errorTracking_1.errorTracking.captureDatabaseError(e, 'initialize_sqlite3_import');
                return Promise.reject(e);
            }
        }
        return new Promise((resolve, reject) => {
            this.db = new this.sqlite3.Database(this.dbPath, async (err) => {
                if (err) {
                    // Track critical database connection error
                    await errorTracking_1.errorTracking.captureDatabaseError(err, 'initialize_connection', {
                        db_path: this.dbPath,
                    });
                    reject(err);
                    return;
                }
                this.ensureMigrations()
                    .then(async () => {
                    await this.validateSchemaContract();
                    resolve();
                })
                    .catch(async (initError) => {
                    const operation = initError instanceof DatabaseSchemaMismatchError
                        ? 'initialize_schema_contract'
                        : 'initialize_migrations';
                    await errorTracking_1.errorTracking.captureDatabaseError(initError, operation, {
                        db_path: this.dbPath,
                    });
                    reject(initError);
                });
            });
        });
    }
    getLastMigrationSummary() {
        return this.lastMigrationSummary;
    }
    async saveProject(project) {
        if (this.disabled)
            return;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const gitRemote = project.gitInfo.remote ?? null;
        const gitBranch = project.gitInfo.branch ?? null;
        const baseRef = this.computeBaseRef(project.gitInfo.baseRef, project.gitInfo.remote, project.gitInfo.branch);
        const githubRepository = project.githubInfo?.repository ?? null;
        const githubConnected = project.githubInfo?.connected ? 1 : 0;
        // Clean up stale rows that would conflict on id or path but not both.
        // This prevents unique constraint errors when re-adding a deleted project.
        await db
            .delete(schema_1.projects)
            .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.projects.id, project.id), (0, drizzle_orm_1.ne)(schema_1.projects.path, project.path)), (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.projects.path, project.path), (0, drizzle_orm_1.ne)(schema_1.projects.id, project.id))));
        await db
            .insert(schema_1.projects)
            .values({
            id: project.id,
            name: project.name,
            path: project.path,
            gitRemote,
            gitBranch,
            baseRef: baseRef ?? null,
            githubRepository,
            githubConnected,
            sshConnectionId: project.sshConnectionId ?? null,
            isRemote: project.isRemote ? 1 : 0,
            remotePath: project.remotePath ?? null,
            updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`,
        })
            .onConflictDoUpdate({
            target: schema_1.projects.path,
            set: {
                name: project.name,
                gitRemote,
                gitBranch,
                baseRef: baseRef ?? null,
                githubRepository,
                githubConnected,
                sshConnectionId: project.sshConnectionId ?? null,
                isRemote: project.isRemote ? 1 : 0,
                remotePath: project.remotePath ?? null,
                updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`,
            },
        });
    }
    async getProjects() {
        if (this.disabled)
            return [];
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const rows = await db.select().from(schema_1.projects).orderBy((0, drizzle_orm_1.desc)(schema_1.projects.updatedAt));
        return rows.map((row) => this.mapDrizzleProjectRow(row));
    }
    async getProjectById(projectId) {
        if (this.disabled)
            return null;
        if (!projectId) {
            throw new Error('projectId is required');
        }
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const rows = await db
            .select()
            .from(schema_1.projects)
            .where((0, drizzle_orm_1.eq)(schema_1.projects.id, projectId))
            .limit(1);
        if (rows.length === 0) {
            return null;
        }
        return this.mapDrizzleProjectRow(rows[0]);
    }
    async updateProjectBaseRef(projectId, nextBaseRef) {
        if (this.disabled)
            return null;
        if (!projectId) {
            throw new Error('projectId is required');
        }
        const trimmed = typeof nextBaseRef === 'string' ? nextBaseRef.trim() : '';
        if (!trimmed) {
            throw new Error('baseRef cannot be empty');
        }
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const rows = await db
            .select({
            id: schema_1.projects.id,
            gitRemote: schema_1.projects.gitRemote,
            gitBranch: schema_1.projects.gitBranch,
        })
            .from(schema_1.projects)
            .where((0, drizzle_orm_1.eq)(schema_1.projects.id, projectId))
            .limit(1);
        if (rows.length === 0) {
            throw new Error(`Project not found: ${projectId}`);
        }
        const source = rows[0];
        const normalized = this.computeBaseRef(trimmed, source.gitRemote, source.gitBranch);
        await db
            .update(schema_1.projects)
            .set({
            baseRef: normalized,
            updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.projects.id, projectId));
        return this.getProjectById(projectId);
    }
    async saveTask(task) {
        if (this.disabled)
            return;
        const metadataValue = typeof task.metadata === 'string'
            ? task.metadata
            : task.metadata
                ? JSON.stringify(task.metadata)
                : null;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db
            .insert(schema_1.tasks)
            .values({
            id: task.id,
            projectId: task.projectId,
            name: task.name,
            branch: task.branch,
            path: task.path,
            status: task.status,
            agentId: task.agentId ?? null,
            metadata: metadataValue,
            useWorktree: task.useWorktree !== false ? 1 : 0,
            updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`,
        })
            .onConflictDoUpdate({
            target: schema_1.tasks.id,
            set: {
                projectId: task.projectId,
                name: task.name,
                branch: task.branch,
                path: task.path,
                status: task.status,
                agentId: task.agentId ?? null,
                metadata: metadataValue,
                useWorktree: task.useWorktree !== false ? 1 : 0,
                updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`,
            },
        });
    }
    async getTasks(projectId) {
        if (this.disabled)
            return [];
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        // Filter out archived tasks by default
        const rows = projectId
            ? await db
                .select()
                .from(schema_1.tasks)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.projectId, projectId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt)))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.tasks.updatedAt))
            : await db
                .select()
                .from(schema_1.tasks)
                .where((0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.tasks.updatedAt));
        return rows.map((row) => this.mapDrizzleTaskRow(row));
    }
    async getArchivedTasks(projectId) {
        if (this.disabled)
            return [];
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const rows = projectId
            ? await db
                .select()
                .from(schema_1.tasks)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.projectId, projectId), (0, drizzle_orm_1.sql) `${schema_1.tasks.archivedAt} IS NOT NULL`))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.tasks.archivedAt))
            : await db
                .select()
                .from(schema_1.tasks)
                .where((0, drizzle_orm_1.sql) `${schema_1.tasks.archivedAt} IS NOT NULL`)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.tasks.archivedAt));
        return rows.map((row) => this.mapDrizzleTaskRow(row));
    }
    async archiveTask(taskId) {
        if (this.disabled)
            return;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db
            .update(schema_1.tasks)
            .set({
            archivedAt: new Date().toISOString(),
            status: 'idle', // Reset status since PTY processes are killed on archive
            updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId));
    }
    async restoreTask(taskId) {
        if (this.disabled)
            return;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db
            .update(schema_1.tasks)
            .set({
            archivedAt: null,
            updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId));
    }
    async getTaskByPath(taskPath) {
        if (this.disabled)
            return null;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const rows = await db.select().from(schema_1.tasks).where((0, drizzle_orm_1.eq)(schema_1.tasks.path, taskPath)).limit(1);
        if (rows.length === 0)
            return null;
        return this.mapDrizzleTaskRow(rows[0]);
    }
    async getTaskById(taskId) {
        if (this.disabled)
            return null;
        if (!taskId)
            return null;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const rows = await db.select().from(schema_1.tasks).where((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId)).limit(1);
        if (rows.length === 0)
            return null;
        return this.mapDrizzleTaskRow(rows[0]);
    }
    async deleteProject(projectId) {
        if (this.disabled)
            return;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db.delete(schema_1.projects).where((0, drizzle_orm_1.eq)(schema_1.projects.id, projectId));
    }
    async deleteTask(taskId) {
        if (this.disabled)
            return;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db.delete(schema_1.tasks).where((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId));
    }
    // Conversation management methods
    async saveConversation(conversation) {
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db
            .insert(schema_1.conversations)
            .values({
            id: conversation.id,
            taskId: conversation.taskId,
            title: conversation.title,
            provider: conversation.provider ?? null,
            isActive: conversation.isActive ? 1 : 0,
            isMain: conversation.isMain ? 1 : 0,
            displayOrder: conversation.displayOrder ?? 0,
            metadata: conversation.metadata ?? null,
            updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`,
        })
            .onConflictDoUpdate({
            target: schema_1.conversations.id,
            set: {
                title: conversation.title,
                provider: conversation.provider ?? null,
                isActive: conversation.isActive ? 1 : 0,
                isMain: conversation.isMain ? 1 : 0,
                displayOrder: conversation.displayOrder ?? 0,
                metadata: conversation.metadata ?? null,
                updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`,
            },
        });
    }
    async getConversations(taskId) {
        if (this.disabled)
            return [];
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const rows = await db
            .select()
            .from(schema_1.conversations)
            .where((0, drizzle_orm_1.eq)(schema_1.conversations.taskId, taskId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.conversations.displayOrder), (0, drizzle_orm_1.desc)(schema_1.conversations.updatedAt));
        return rows.map((row) => this.mapDrizzleConversationRow(row));
    }
    async getOrCreateDefaultConversation(taskId, provider) {
        if (this.disabled) {
            return {
                id: `conv-${taskId}-default`,
                taskId,
                title: 'Default Conversation',
                provider: provider ?? null,
                isMain: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
        }
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const existingRows = await db
            .select()
            .from(schema_1.conversations)
            .where((0, drizzle_orm_1.eq)(schema_1.conversations.taskId, taskId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.conversations.createdAt))
            .limit(1);
        if (existingRows.length > 0) {
            const existing = existingRows[0];
            // Backfill provider if it was previously saved as null
            if (!existing.provider && provider) {
                await db
                    .update(schema_1.conversations)
                    .set({ provider, updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP` })
                    .where((0, drizzle_orm_1.eq)(schema_1.conversations.id, existing.id));
                return this.mapDrizzleConversationRow({ ...existing, provider });
            }
            return this.mapDrizzleConversationRow(existing);
        }
        const conversationId = `conv-${taskId}-${Date.now()}`;
        await this.saveConversation({
            id: conversationId,
            taskId,
            title: 'Default Conversation',
            provider: provider ?? null,
            isMain: true,
            isActive: true,
        });
        const [createdRow] = await db
            .select()
            .from(schema_1.conversations)
            .where((0, drizzle_orm_1.eq)(schema_1.conversations.id, conversationId))
            .limit(1);
        if (createdRow) {
            return this.mapDrizzleConversationRow(createdRow);
        }
        return {
            id: conversationId,
            taskId,
            title: 'Default Conversation',
            provider: provider ?? null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
    }
    // Message management methods
    async saveMessage(message) {
        if (this.disabled)
            return;
        const metadataValue = typeof message.metadata === 'string'
            ? message.metadata
            : message.metadata
                ? JSON.stringify(message.metadata)
                : null;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db.transaction(async (tx) => {
            await tx
                .insert(schema_1.messages)
                .values({
                id: message.id,
                conversationId: message.conversationId,
                content: message.content,
                sender: message.sender,
                metadata: metadataValue,
                timestamp: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`,
            })
                .onConflictDoNothing()
                .run();
            await tx
                .update(schema_1.conversations)
                .set({ updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP` })
                .where((0, drizzle_orm_1.eq)(schema_1.conversations.id, message.conversationId))
                .run();
        });
    }
    async getMessages(conversationId) {
        if (this.disabled)
            return [];
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const rows = await db
            .select()
            .from(schema_1.messages)
            .where((0, drizzle_orm_1.eq)(schema_1.messages.conversationId, conversationId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.messages.timestamp));
        return rows.map((row) => this.mapDrizzleMessageRow(row));
    }
    async deleteConversation(conversationId) {
        if (this.disabled)
            return;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db.delete(schema_1.conversations).where((0, drizzle_orm_1.eq)(schema_1.conversations.id, conversationId));
    }
    // New multi-chat methods
    async createConversation(taskId, title, provider, isMain) {
        if (this.disabled) {
            return {
                id: `conv-${taskId}-${Date.now()}`,
                taskId,
                title,
                provider: provider ?? null,
                isActive: true,
                isMain: isMain ?? false,
                displayOrder: 0,
                metadata: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
        }
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        // Get the next display order
        const existingConversations = await db
            .select()
            .from(schema_1.conversations)
            .where((0, drizzle_orm_1.eq)(schema_1.conversations.taskId, taskId));
        const maxOrder = Math.max(...existingConversations.map((c) => c.displayOrder || 0), -1);
        // Check if this should be the main conversation
        // If explicitly set as main, check if one already exists
        if (isMain === true) {
            const hasMain = existingConversations.some((c) => c.isMain === 1);
            if (hasMain) {
                isMain = false; // Don't allow multiple main conversations
            }
        }
        else if (isMain === undefined) {
            // If not specified, make it main only if it's the first conversation
            isMain = existingConversations.length === 0;
        }
        // Deactivate other conversations
        await db
            .update(schema_1.conversations)
            .set({ isActive: 0 })
            .where((0, drizzle_orm_1.eq)(schema_1.conversations.taskId, taskId));
        // Create the new conversation
        const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newConversation = {
            id: conversationId,
            taskId,
            title,
            provider: provider ?? null,
            isActive: true,
            isMain: isMain ?? false,
            displayOrder: maxOrder + 1,
        };
        await this.saveConversation(newConversation);
        // Fetch the created conversation
        const [createdRow] = await db
            .select()
            .from(schema_1.conversations)
            .where((0, drizzle_orm_1.eq)(schema_1.conversations.id, conversationId))
            .limit(1);
        return this.mapDrizzleConversationRow(createdRow);
    }
    async setActiveConversation(taskId, conversationId) {
        if (this.disabled)
            return;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db.transaction(async (tx) => {
            // Deactivate all conversations for this task
            await tx
                .update(schema_1.conversations)
                .set({ isActive: 0 })
                .where((0, drizzle_orm_1.eq)(schema_1.conversations.taskId, taskId));
            // Activate the selected one
            await tx
                .update(schema_1.conversations)
                .set({ isActive: 1, updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP` })
                .where((0, drizzle_orm_1.eq)(schema_1.conversations.id, conversationId));
        });
    }
    async getActiveConversation(taskId) {
        if (this.disabled)
            return null;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const results = await db
            .select()
            .from(schema_1.conversations)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.conversations.taskId, taskId), (0, drizzle_orm_1.eq)(schema_1.conversations.isActive, 1)))
            .limit(1);
        return results[0] ? this.mapDrizzleConversationRow(results[0]) : null;
    }
    async reorderConversations(taskId, conversationIds) {
        if (this.disabled)
            return;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db.transaction(async (tx) => {
            for (let i = 0; i < conversationIds.length; i++) {
                await tx
                    .update(schema_1.conversations)
                    .set({ displayOrder: i })
                    .where((0, drizzle_orm_1.eq)(schema_1.conversations.id, conversationIds[i]));
            }
        });
    }
    async updateConversationTitle(conversationId, title) {
        if (this.disabled)
            return;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db
            .update(schema_1.conversations)
            .set({ title, updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP` })
            .where((0, drizzle_orm_1.eq)(schema_1.conversations.id, conversationId));
    }
    // Line comment management methods
    async saveLineComment(input) {
        if (this.disabled)
            return '';
        const id = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db.insert(schema_1.lineComments).values({
            id,
            taskId: input.taskId,
            filePath: input.filePath,
            lineNumber: input.lineNumber,
            lineContent: input.lineContent ?? null,
            content: input.content,
            updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`,
        });
        return id;
    }
    async getLineComments(taskId, filePath) {
        if (this.disabled)
            return [];
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        if (filePath) {
            const rows = await db
                .select()
                .from(schema_1.lineComments)
                .where((0, drizzle_orm_1.sql) `${schema_1.lineComments.taskId} = ${taskId} AND ${schema_1.lineComments.filePath} = ${filePath}`)
                .orderBy((0, drizzle_orm_1.asc)(schema_1.lineComments.lineNumber));
            return rows;
        }
        const rows = await db
            .select()
            .from(schema_1.lineComments)
            .where((0, drizzle_orm_1.eq)(schema_1.lineComments.taskId, taskId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.lineComments.lineNumber));
        return rows;
    }
    async updateLineComment(id, content) {
        if (this.disabled)
            return;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db
            .update(schema_1.lineComments)
            .set({
            content,
            updatedAt: (0, drizzle_orm_1.sql) `CURRENT_TIMESTAMP`,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.lineComments.id, id));
    }
    async deleteLineComment(id) {
        if (this.disabled)
            return;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        await db.delete(schema_1.lineComments).where((0, drizzle_orm_1.eq)(schema_1.lineComments.id, id));
    }
    async markCommentsSent(commentIds) {
        if (this.disabled || commentIds.length === 0)
            return;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const now = new Date().toISOString();
        await db
            .update(schema_1.lineComments)
            .set({ sentAt: now })
            .where((0, drizzle_orm_1.inArray)(schema_1.lineComments.id, commentIds));
    }
    async getUnsentComments(taskId) {
        if (this.disabled)
            return [];
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const rows = await db
            .select()
            .from(schema_1.lineComments)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.lineComments.taskId, taskId), (0, drizzle_orm_1.isNull)(schema_1.lineComments.sentAt)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.lineComments.filePath), (0, drizzle_orm_1.asc)(schema_1.lineComments.lineNumber));
        return rows;
    }
    // SSH connection management methods
    async saveSshConnection(connection) {
        if (this.disabled) {
            throw new Error('Database is disabled');
        }
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const id = connection.id ?? `ssh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = new Date().toISOString();
        const result = await db
            .insert(schema_1.sshConnections)
            .values({
            ...connection,
            id,
            createdAt: now,
            updatedAt: now,
        })
            .onConflictDoUpdate({
            target: schema_1.sshConnections.id,
            set: {
                name: connection.name,
                host: connection.host,
                port: connection.port,
                username: connection.username,
                authType: connection.authType,
                privateKeyPath: connection.privateKeyPath ?? null,
                useAgent: connection.useAgent,
                updatedAt: now,
            },
        })
            .returning();
        return result[0];
    }
    async getSshConnections() {
        if (this.disabled)
            return [];
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        return db.select().from(schema_1.sshConnections).orderBy(schema_1.sshConnections.name);
    }
    async getSshConnection(id) {
        if (this.disabled)
            return null;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const rows = await db
            .select()
            .from(schema_1.sshConnections)
            .where((0, drizzle_orm_1.eq)(schema_1.sshConnections.id, id))
            .limit(1);
        return rows.length > 0 ? rows[0] : null;
    }
    async deleteSshConnection(id) {
        if (this.disabled)
            return;
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        // First update any projects using this connection
        await db
            .update(schema_1.projects)
            .set({ sshConnectionId: null, isRemote: 0 })
            .where((0, drizzle_orm_1.eq)(schema_1.projects.sshConnectionId, id));
        // Then delete the connection
        await db.delete(schema_1.sshConnections).where((0, drizzle_orm_1.eq)(schema_1.sshConnections.id, id));
    }
    computeBaseRef(preferred, remote, branch) {
        const remoteName = this.getRemoteAlias(remote);
        const normalize = (value) => {
            if (!value)
                return undefined;
            const trimmed = value.trim();
            if (!trimmed || trimmed.includes('://'))
                return undefined;
            if (trimmed.includes('/')) {
                const [head, ...rest] = trimmed.split('/');
                const branchPart = rest.join('/').replace(/^\/+/, '');
                if (head && branchPart) {
                    return `${head}/${branchPart}`;
                }
                if (!head && branchPart) {
                    // Leading slash - prepend remote if available
                    return remoteName ? `${remoteName}/${branchPart}` : branchPart;
                }
                return undefined;
            }
            // Plain branch name - prepend remote only if one exists
            const suffix = trimmed.replace(/^\/+/, '');
            return remoteName ? `${remoteName}/${suffix}` : suffix;
        };
        // Default: use origin/main if remote exists, otherwise just 'main'
        const defaultBranch = remoteName
            ? `${remoteName}/${this.defaultBranchName()}`
            : this.defaultBranchName();
        return normalize(preferred) ?? normalize(branch) ?? defaultBranch;
    }
    defaultRemoteName() {
        return 'origin';
    }
    getRemoteAlias(remote) {
        if (!remote)
            return this.defaultRemoteName();
        const trimmed = remote.trim();
        if (!trimmed)
            return ''; // Empty string indicates no remote (local-only repo)
        if (/^[A-Za-z0-9._-]+$/.test(trimmed) && !trimmed.includes('://')) {
            return trimmed;
        }
        return this.defaultRemoteName();
    }
    defaultBranchName() {
        return 'main';
    }
    mapDrizzleProjectRow(row) {
        return {
            id: row.id,
            name: row.name,
            path: row.path,
            isRemote: row.isRemote === 1,
            sshConnectionId: row.sshConnectionId ?? null,
            remotePath: row.remotePath ?? null,
            gitInfo: {
                isGitRepo: !!(row.gitRemote || row.gitBranch),
                remote: row.gitRemote ?? undefined,
                branch: row.gitBranch ?? undefined,
                baseRef: this.computeBaseRef(row.baseRef, row.gitRemote, row.gitBranch),
            },
            githubInfo: row.githubRepository
                ? {
                    repository: row.githubRepository,
                    connected: !!row.githubConnected,
                }
                : undefined,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }
    mapDrizzleTaskRow(row) {
        return {
            id: row.id,
            projectId: row.projectId,
            name: row.name,
            branch: row.branch,
            path: row.path,
            status: row.status ?? 'idle',
            agentId: row.agentId ?? null,
            metadata: typeof row.metadata === 'string' && row.metadata.length > 0
                ? this.parseTaskMetadata(row.metadata, row.id)
                : null,
            useWorktree: row.useWorktree === 1,
            archivedAt: row.archivedAt ?? null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }
    mapDrizzleConversationRow(row) {
        return {
            id: row.id,
            taskId: row.taskId,
            title: row.title,
            provider: row.provider ?? null,
            isActive: row.isActive === 1,
            // For backward compatibility: treat missing isMain as true (assume first/only conversation is main)
            isMain: row.isMain !== undefined ? row.isMain === 1 : true,
            displayOrder: row.displayOrder ?? 0,
            metadata: row.metadata ?? null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }
    mapDrizzleMessageRow(row) {
        return {
            id: row.id,
            conversationId: row.conversationId,
            content: row.content,
            sender: row.sender,
            timestamp: row.timestamp,
            metadata: row.metadata ?? undefined,
        };
    }
    parseTaskMetadata(serialized, taskId) {
        try {
            return JSON.parse(serialized);
        }
        catch (error) {
            console.warn(`Failed to parse task metadata for ${taskId}`, error);
            return null;
        }
    }
    async close() {
        if (this.disabled || !this.db)
            return;
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }
    async ensureMigrations() {
        if (this.disabled)
            return;
        if (!this.db)
            throw new Error('Database not initialized');
        if (DatabaseService.migrationsApplied)
            return;
        const migrationsPath = (0, path_1.resolveMigrationsPath)();
        if (!migrationsPath) {
            // Provide a detailed error message for debugging
            const errorMsg = [
                'Failed to locate database migrations folder.',
                'This can happen when:',
                '1. The app was installed via Homebrew (try downloading directly from GitHub)',
                '2. The app is running from Downloads/DMG (move it to Applications)',
                '3. The installation is incomplete or corrupted',
                '4. Security software is blocking file access',
                '',
                'To fix: Try downloading and installing Emdash directly from:',
                'https://github.com/generalaction/emdash/releases',
                '',
            ].join('\n');
            throw new Error(errorMsg);
        }
        // We run schema migrations with foreign_keys disabled.
        // Many dev DBs were created with foreign_keys=OFF, so legacy data can contain orphans.
        // Enabling FK enforcement mid-migration can cause schema transitions (table rebuilds) to fail.
        await this.execSql('PRAGMA foreign_keys=OFF;');
        try {
            // IMPORTANT:
            // Drizzle's built-in migrator for sqlite-proxy decides what to run based on the latest
            // `created_at` timestamp in __drizzle_migrations. If a migration is added later but has an
            // earlier timestamp than the latest applied migration, Drizzle will skip it forever.
            //
            // To make migrations robust for dev DBs (and for any DB that may have extra migrations),
            // we apply migrations by missing hash instead of timestamp ordering.
            const migrations = (0, migrator_1.readMigrationFiles)({ migrationsFolder: migrationsPath });
            const tagByWhen = await this.tryLoadMigrationTagByWhen(migrationsPath);
            await this.execSql(`
        CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at numeric
        )
      `);
            const appliedRows = await this.allSql(`SELECT hash FROM "__drizzle_migrations"`);
            const applied = new Set(appliedRows.map((r) => r.hash));
            // Recovery: if a previous run partially applied the workspace->task migration, finish it.
            // Symptom: `tasks` exists, `conversations` still has `workspace_id`, and `__new_conversations` exists.
            let recovered = false;
            if ((await this.tableExists('tasks')) &&
                (await this.tableExists('conversations')) &&
                (await this.tableExists('__new_conversations')) &&
                (await this.tableHasColumn('conversations', 'workspace_id')) &&
                !(await this.tableHasColumn('conversations', 'task_id'))) {
                // Populate new conversations table from the old one (FK enforcement is OFF, so orphans won't block)
                await this.execSql(`
          INSERT INTO "__new_conversations"("id", "task_id", "title", "created_at", "updated_at")
          SELECT "id", "workspace_id", "title", "created_at", "updated_at" FROM "conversations"
        `);
                await this.execSql(`DROP TABLE "conversations";`);
                await this.execSql(`ALTER TABLE "__new_conversations" RENAME TO "conversations";`);
                await this.execSql(`CREATE INDEX IF NOT EXISTS "idx_conversations_task_id" ON "conversations" ("task_id");`);
                // Mark the workspace->task migration as applied (even if it wasn't tracked).
                // This prevents the hash-based runner from attempting to re-run it against a partially-migrated DB.
                await this.ensureMigrationMarkedApplied(migrationsPath, applied, '0002_lyrical_impossible_man');
                recovered = true;
            }
            let appliedCount = 0;
            for (const migration of migrations) {
                if (applied.has(migration.hash))
                    continue;
                const tag = tagByWhen?.get(migration.folderMillis);
                // If the DB already reflects the workspace->task rename (e.g. user manually fixed their DB)
                // but the migration hash wasn't recorded, mark it as applied and move on.
                if (tag === '0002_lyrical_impossible_man' &&
                    (await this.tableExists('tasks')) &&
                    !(await this.tableExists('workspaces')) &&
                    (await this.tableExists('conversations')) &&
                    (await this.tableHasColumn('conversations', 'task_id'))) {
                    await this.execSql(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES('${migration.hash}', '${migration.folderMillis}')`);
                    applied.add(migration.hash);
                    continue;
                }
                // Execute each statement chunk (drizzle-kit uses '--> statement-breakpoint')
                for (const statement of migration.sql) {
                    // We manage FK enforcement ourselves during migrations.
                    const trimmed = statement.trim().toUpperCase();
                    if (trimmed.startsWith('PRAGMA FOREIGN_KEYS='))
                        continue;
                    await this.execSql(statement);
                }
                // Record as applied (same schema as Drizzle uses)
                await this.execSql(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES('${migration.hash}', '${migration.folderMillis}')`);
                applied.add(migration.hash);
                appliedCount += 1;
            }
            this.lastMigrationSummary = {
                appliedCount,
                totalMigrations: migrations.length,
                recovered,
            };
            DatabaseService.migrationsApplied = true;
        }
        finally {
            // Restore FK enforcement for normal operation (and ensure it's re-enabled on failure).
            await this.execSql('PRAGMA foreign_keys=ON;');
        }
    }
    async validateSchemaContract() {
        if (this.disabled)
            return;
        const missingInvariants = [];
        if (!(await this.tableHasColumn('projects', 'base_ref'))) {
            missingInvariants.push('projects.base_ref');
        }
        if (!(await this.tableExists('tasks'))) {
            missingInvariants.push('tasks table');
        }
        if (!(await this.tableHasColumn('conversations', 'task_id'))) {
            missingInvariants.push('conversations.task_id');
        }
        if (missingInvariants.length > 0) {
            throw new DatabaseSchemaMismatchError(this.dbPath, missingInvariants);
        }
    }
    async tryLoadMigrationTagByWhen(migrationsFolder) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const fs = require('node:fs');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const path = require('node:path');
            const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
            if (!fs.existsSync(journalPath))
                return null;
            const parsed = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
            if (!parsed || typeof parsed !== 'object')
                return null;
            const entries = parsed.entries;
            if (!Array.isArray(entries))
                return null;
            const map = new Map();
            for (const e of entries) {
                if (!e || typeof e !== 'object')
                    continue;
                const when = e.when;
                const tag = e.tag;
                if (typeof when === 'number' && typeof tag === 'string') {
                    map.set(when, tag);
                }
            }
            return map;
        }
        catch {
            return null;
        }
    }
    async ensureMigrationMarkedApplied(migrationsFolder, applied, tag) {
        // Only mark if the SQL file + journal entry exist.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('node:fs');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const path = require('node:path');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const crypto = require('node:crypto');
        const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
        if (!fs.existsSync(journalPath))
            return;
        const journalParsed = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
        const entries = journalParsed.entries;
        if (!Array.isArray(entries))
            return;
        const entry = entries.find((e) => {
            if (!e || typeof e !== 'object')
                return false;
            return e.tag === tag;
        });
        if (!entry)
            return;
        const sqlPath = path.join(migrationsFolder, `${tag}.sql`);
        if (!fs.existsSync(sqlPath))
            return;
        const contents = fs.readFileSync(sqlPath, 'utf8');
        const hash = crypto.createHash('sha256').update(contents).digest('hex');
        if (applied.has(hash))
            return;
        const createdAt = typeof entry.when === 'number' ? entry.when : Date.now();
        await this.execSql(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES('${hash}', '${createdAt}')`);
        applied.add(hash);
    }
    async tableExists(name) {
        const rows = await this.allSql(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name.replace(/'/g, "''")}' LIMIT 1`);
        return rows.length > 0;
    }
    async tableHasColumn(tableName, columnName) {
        if (!(await this.tableExists(tableName)))
            return false;
        const rows = await this.allSql(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`);
        return rows.some((r) => r.name === columnName);
    }
    async allSql(query) {
        if (!this.db)
            throw new Error('Database not initialized');
        const trimmed = query.trim();
        if (!trimmed)
            return [];
        return await new Promise((resolve, reject) => {
            this.db.all(trimmed, (err, rows) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve((rows ?? []));
                }
            });
        });
    }
    async execSql(statement) {
        if (!this.db)
            throw new Error('Database not initialized');
        const trimmed = statement.trim();
        if (!trimmed)
            return;
        await new Promise((resolve, reject) => {
            this.db.exec(trimmed, (err) => {
                if (err) {
                    // Handle idempotent migration cases - skip if schema already matches
                    const msg = err.message ?? '';
                    if (msg.includes('duplicate column name') || msg.includes('already exists')) {
                        // Schema change already applied, continue
                        resolve();
                        return;
                    }
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }
}
exports.DatabaseService = DatabaseService;
DatabaseService.migrationsApplied = false;
exports.databaseService = new DatabaseService();
