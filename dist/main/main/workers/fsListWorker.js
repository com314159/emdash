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
const worker_threads_1 = require("worker_threads");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const fsIgnores_1 = require("../utils/fsIgnores");
const safeStat_1 = require("../utils/safeStat");
const yieldImmediate = () => new Promise((resolve) => setImmediate(resolve));
async function listFiles(request) {
    const items = [];
    const stack = ['.'];
    const start = Date.now();
    const deadline = start + request.timeBudgetMs;
    let truncated = false;
    let reason;
    let visited = 0;
    while (stack.length > 0) {
        if (items.length >= request.maxEntries) {
            truncated = true;
            reason = 'maxEntries';
            break;
        }
        if (Date.now() >= deadline) {
            truncated = true;
            reason = 'timeBudget';
            break;
        }
        const rel = stack.pop();
        const abs = path.join(request.root, rel);
        const stat = (0, safeStat_1.safeStat)(abs);
        if (!stat)
            continue;
        if (stat.isDirectory()) {
            const name = path.basename(abs);
            if (rel !== '.' && fsIgnores_1.DEFAULT_IGNORES.has(name))
                continue;
            if (rel !== '.' && request.includeDirs) {
                items.push({ path: rel, type: 'dir' });
                if (items.length >= request.maxEntries) {
                    truncated = true;
                    reason = 'maxEntries';
                    break;
                }
            }
            // If not recursive and we are deeper than root, don't scan children
            if (request.recursive === false && rel !== '.') {
                continue;
            }
            let entries = [];
            try {
                entries = fs.readdirSync(abs);
            }
            catch {
                continue;
            }
            for (let i = entries.length - 1; i >= 0; i--) {
                const entry = entries[i];
                if (fsIgnores_1.DEFAULT_IGNORES.has(entry))
                    continue;
                const nextRel = rel === '.' ? entry : path.join(rel, entry);
                stack.push(nextRel);
            }
        }
        else if (stat.isFile()) {
            items.push({ path: rel, type: 'file' });
            if (items.length >= request.maxEntries) {
                truncated = true;
                reason = 'maxEntries';
                break;
            }
        }
        visited += 1;
        if (visited % request.batchSize === 0) {
            await yieldImmediate();
        }
    }
    return {
        taskId: request.taskId,
        ok: true,
        items,
        truncated,
        reason,
        durationMs: Date.now() - start,
    };
}
if (!worker_threads_1.parentPort) {
    throw new Error('fsListWorker must be run as a worker thread');
}
worker_threads_1.parentPort.on('message', async (request) => {
    try {
        const result = await listFiles(request);
        worker_threads_1.parentPort?.postMessage(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        worker_threads_1.parentPort?.postMessage({
            taskId: request.taskId,
            ok: false,
            error: message,
        });
    }
});
