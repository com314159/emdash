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
exports.codexSessionService = void 0;
exports._setCodexStatePathForTest = _setCodexStatePathForTest;
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../lib/logger");
let codexStatePathOverride = null;
function _setCodexStatePathForTest(nextPath) {
    codexStatePathOverride = nextPath;
}
function resolveCodexStatePath() {
    return codexStatePathOverride || path_1.default.join(os_1.default.homedir(), '.codex', 'state_5.sqlite');
}
class CodexSessionService {
    constructor() {
        this.sqliteModulePromise = null;
    }
    async loadSqliteModule() {
        if (!this.sqliteModulePromise) {
            this.sqliteModulePromise = Promise.resolve().then(() => __importStar(require('sqlite3'))).then((mod) => mod);
        }
        return this.sqliteModulePromise;
    }
    async openDatabase() {
        const sqliteModule = await this.loadSqliteModule();
        const dbPath = resolveCodexStatePath();
        return await new Promise((resolve, reject) => {
            const db = new sqliteModule.Database(dbPath, sqliteModule.OPEN_READONLY, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (typeof db.configure === 'function') {
                    db.configure('busyTimeout', 2000);
                }
                resolve(db);
            });
        });
    }
    async closeDatabase(db) {
        await new Promise((resolve) => {
            db.close(() => resolve());
        });
    }
    async all(sql, params) {
        const db = await this.openDatabase();
        try {
            return await new Promise((resolve, reject) => {
                db.all(sql, params, (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(rows ?? []);
                });
            });
        }
        finally {
            await this.closeDatabase(db);
        }
    }
    async get(sql, params) {
        const db = await this.openDatabase();
        try {
            return await new Promise((resolve, reject) => {
                db.get(sql, params, (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(row ?? null);
                });
            });
        }
        finally {
            await this.closeDatabase(db);
        }
    }
    mapThreadRow(row) {
        if (!row)
            return null;
        if (typeof row.id !== 'string' || typeof row.cwd !== 'string') {
            return null;
        }
        return {
            id: row.id,
            cwd: row.cwd,
            createdAt: Number(row.created_at ?? 0),
            updatedAt: Number(row.updated_at ?? 0),
            archived: Boolean(row.archived ?? 0),
        };
    }
    async findThreadById(threadId) {
        try {
            const row = await this.get('SELECT id, cwd, created_at, updated_at, archived FROM threads WHERE id = ? LIMIT 1', [threadId]);
            return this.mapThreadRow(row);
        }
        catch (error) {
            logger_1.log.warn('CodexSessionService: failed to load thread by id', {
                threadId,
                error: String(error),
            });
            return null;
        }
    }
    async threadExistsForCwd(threadId, cwd) {
        const thread = await this.findThreadById(threadId);
        return !!thread && !thread.archived && thread.cwd === cwd;
    }
    async findRecentThreadsForCwd(cwd, sinceMs) {
        const sinceSeconds = Math.max(0, Math.floor(sinceMs / 1000));
        try {
            const rows = await this.all(`SELECT id, cwd, created_at, updated_at, archived
         FROM threads
         WHERE cwd = ?
           AND archived = 0
           AND (updated_at >= ? OR created_at >= ?)
         ORDER BY updated_at DESC, created_at DESC`, [cwd, sinceSeconds, sinceSeconds]);
            return rows.map((row) => this.mapThreadRow(row)).filter((row) => !!row);
        }
        catch (error) {
            logger_1.log.warn('CodexSessionService: failed to load recent threads for cwd', {
                cwd,
                sinceMs,
                sinceSeconds,
                dbPath: resolveCodexStatePath(),
                error: String(error),
            });
            return [];
        }
    }
    async findLatestThreadForCwd(cwd) {
        try {
            const row = await this.get(`SELECT id, cwd, created_at, updated_at, archived
         FROM threads
         WHERE cwd = ?
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`, [cwd]);
            return this.mapThreadRow(row);
        }
        catch (error) {
            logger_1.log.warn('CodexSessionService: failed to load latest thread for cwd', {
                cwd,
                dbPath: resolveCodexStatePath(),
                error: String(error),
            });
            return null;
        }
    }
    async findLatestRecentThreadForCwd(cwd, sinceMs) {
        const threads = await this.findRecentThreadsForCwd(cwd, sinceMs);
        return threads[0] ?? null;
    }
}
exports.codexSessionService = new CodexSessionService();
