"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.terminalSnapshotService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const logger_1 = require("../lib/logger");
const terminalSnapshot_1 = require("../types/terminalSnapshot");
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
function resolveBaseDir() {
    const override = process.env.EMDASH_TERMINAL_SNAPSHOT_DIR;
    if (override && override.trim().length > 0) {
        return path_1.default.resolve(override);
    }
    try {
        return path_1.default.join(electron_1.app.getPath('userData'), 'terminal-snapshots');
    }
    catch (error) {
        logger_1.log.warn('terminalSnapshotService: unable to resolve userData path, using cwd fallback', {
            error,
        });
        return path_1.default.join(process.cwd(), '.emdash-terminal-snapshots');
    }
}
const BASE_DIR = resolveBaseDir();
function snapshotPath(id) {
    const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path_1.default.join(BASE_DIR, `${safe}.json`);
}
async function ensureDir() {
    await fs_1.default.promises.mkdir(BASE_DIR, { recursive: true });
}
async function readSnapshotFile(filePath) {
    let raw;
    try {
        raw = await fs_1.default.promises.readFile(filePath, 'utf8');
    }
    catch (error) {
        if (error?.code !== 'ENOENT') {
            logger_1.log.warn('terminalSnapshotService: failed to read snapshot', { filePath, error });
        }
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed.version !== terminalSnapshot_1.TERMINAL_SNAPSHOT_VERSION) {
            return null;
        }
        const bytes = Buffer.byteLength(raw, 'utf8');
        return { ...parsed, bytes };
    }
    catch (error) {
        logger_1.log.warn('terminalSnapshotService: invalid snapshot JSON', {
            filePath,
            error,
            bytes: Buffer.byteLength(raw, 'utf8'),
        });
        return null;
    }
}
async function removeFile(filePath) {
    try {
        await fs_1.default.promises.unlink(filePath);
    }
    catch (error) {
        if (error?.code !== 'ENOENT') {
            logger_1.log.warn('terminalSnapshotService: failed to delete snapshot', { filePath, error });
        }
    }
}
async function listSnapshots() {
    try {
        const entries = await fs_1.default.promises.readdir(BASE_DIR);
        const result = [];
        for (const entry of entries) {
            if (!entry.endsWith('.json'))
                continue;
            const filePath = path_1.default.join(BASE_DIR, entry);
            const stats = await readSnapshotFile(filePath);
            if (stats) {
                const id = entry.replace(/\.json$/, '');
                result.push({ id, path: filePath, stats });
            }
        }
        return result;
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return [];
        logger_1.log.warn('terminalSnapshotService: failed to list snapshots', { error });
        return [];
    }
}
class TerminalSnapshotService {
    async getSnapshot(id) {
        const record = await readSnapshotFile(snapshotPath(id));
        return record ? { ...record } : null;
    }
    async saveSnapshot(id, payload) {
        try {
            if (payload.version !== terminalSnapshot_1.TERMINAL_SNAPSHOT_VERSION) {
                return { ok: false, error: 'Unsupported snapshot version' };
            }
            const json = JSON.stringify(payload);
            const bytes = Buffer.byteLength(json, 'utf8');
            if (bytes > MAX_SNAPSHOT_BYTES) {
                return { ok: false, error: 'Snapshot size exceeds per-task limit' };
            }
            await ensureDir();
            await fs_1.default.promises.writeFile(snapshotPath(id), json, 'utf8');
            await this.pruneIfNeeded(id);
            return { ok: true };
        }
        catch (error) {
            logger_1.log.error('terminalSnapshotService: failed to save snapshot', { id, error });
            return { ok: false, error: error?.message ?? String(error) };
        }
    }
    async deleteSnapshot(id) {
        await removeFile(snapshotPath(id));
    }
    async pruneIfNeeded(recentId) {
        const records = await listSnapshots();
        if (records.length === 0)
            return;
        let total = records.reduce((sum, rec) => sum + rec.stats.bytes, 0);
        if (total <= MAX_TOTAL_BYTES)
            return;
        // Sort by oldest first, prefer to keep the most recent snapshot we just wrote
        const ordered = records
            .filter((rec) => rec.id !== recentId)
            .sort((a, b) => Date.parse(a.stats.createdAt) - Date.parse(b.stats.createdAt));
        for (const entry of ordered) {
            if (total <= MAX_TOTAL_BYTES)
                break;
            await removeFile(entry.path);
            total -= entry.stats.bytes;
        }
        // As a last resort, keep only the recent snapshot
        if (total > MAX_TOTAL_BYTES) {
            for (const entry of records) {
                if (entry.id === recentId)
                    continue;
                await removeFile(entry.path);
            }
        }
    }
}
exports.terminalSnapshotService = new TerminalSnapshotService();
