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
exports.createDrizzleClient = createDrizzleClient;
exports.getDrizzleClient = getDrizzleClient;
exports.resetDrizzleClient = resetDrizzleClient;
const sqlite_proxy_1 = require("drizzle-orm/sqlite-proxy");
const schema = __importStar(require("./schema"));
const path_1 = require("./path");
let sqliteModulePromise = null;
let cachedInternal = null;
const DEFAULT_BUSY_TIMEOUT_MS = 5000;
async function loadSqliteModule() {
    if (!sqliteModulePromise) {
        sqliteModulePromise = Promise.resolve().then(() => __importStar(require('sqlite3'))).then((mod) => mod);
    }
    return sqliteModulePromise;
}
function normalizeParams(params) {
    return Array.isArray(params) ? params : [];
}
function createCallbacks(db) {
    const runStatement = (sql, params) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
                return;
            }
            resolve({
                rows: [],
                lastID: this.lastID,
                changes: this.changes,
            });
        });
    });
    const allStatement = (sql, params) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(rows);
        });
    });
    const getStatement = (sql, params) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(row ?? undefined);
            }
        });
    });
    const mapRowToValues = (row) => {
        if (Array.isArray(row)) {
            return row;
        }
        if (row && typeof row === 'object') {
            return Object.values(row);
        }
        return [];
    };
    const remote = async (sql, params, method) => {
        const normalized = normalizeParams(params);
        switch (method) {
            case 'run': {
                const result = await runStatement(sql, normalized);
                return {
                    rows: result.rows,
                    lastID: result.lastID,
                    changes: result.changes,
                };
            }
            case 'all': {
                const rows = await allStatement(sql, normalized);
                return { rows: rows.map(mapRowToValues) };
            }
            case 'get': {
                const row = await getStatement(sql, normalized);
                return {
                    rows: row === undefined ? null : mapRowToValues(row),
                };
            }
            case 'values': {
                const rows = await allStatement(sql, normalized);
                const values = rows.map((row) => Array.isArray(row) ? row : Object.values(row));
                return { rows: values };
            }
            default: {
                throw new Error(`Unsupported sqlite method "${method}"`);
            }
        }
    };
    const batch = async (operations) => {
        const results = [];
        for (const op of operations) {
            results.push(await remote(op.sql, op.params, op.method));
        }
        return results;
    };
    return { remote, batch };
}
async function openDatabase(filePath, busyTimeoutMs) {
    const sqliteModule = await loadSqliteModule();
    const db = await new Promise((resolve, reject) => {
        const instance = new sqliteModule.Database(filePath, (err) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(instance);
            }
        });
    });
    if (typeof db.configure === 'function') {
        db.configure('busyTimeout', busyTimeoutMs);
    }
    return db;
}
async function createDrizzleClient(options = {}) {
    if (process.env.EMDASH_DISABLE_NATIVE_DB === '1') {
        throw new Error('Native SQLite database is disabled via EMDASH_DISABLE_NATIVE_DB=1');
    }
    const busyTimeout = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    const db = options.database ??
        (await openDatabase(options.filePath ?? (0, path_1.resolveDatabasePath)(), busyTimeout));
    const { remote, batch } = createCallbacks(db);
    const drizzleDb = (0, sqlite_proxy_1.drizzle)(remote, batch, { schema });
    const client = {
        db: drizzleDb,
        sqlite: db,
        close: () => new Promise((resolve, reject) => {
            db.close((err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        }),
    };
    const shouldCache = options.cacheResult ?? (!options.database && options.filePath === undefined);
    if (shouldCache) {
        cachedInternal = {
            client,
            owned: !options.database,
        };
    }
    return client;
}
async function getDrizzleClient() {
    if (cachedInternal) {
        return cachedInternal.client;
    }
    return await createDrizzleClient();
}
async function resetDrizzleClient() {
    if (!cachedInternal)
        return;
    if (cachedInternal.owned) {
        await cachedInternal.client.close().catch(() => { });
    }
    cachedInternal = null;
}
