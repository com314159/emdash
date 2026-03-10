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
exports.registerPlanLockIpc = registerPlanLockIpc;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function isWindows() {
    return process.platform === 'win32';
}
function isSymlink(p) {
    try {
        const st = fs.lstatSync(p);
        return st.isSymbolicLink();
    }
    catch {
        return false;
    }
}
function collectPaths(root) {
    const result = [];
    const stack = ['.'];
    while (stack.length) {
        const rel = stack.pop();
        const abs = path.join(root, rel);
        if (isSymlink(abs))
            continue;
        let st;
        try {
            st = fs.statSync(abs);
        }
        catch {
            continue;
        }
        if (st.isDirectory()) {
            // Skip our internal folder so we can write logs/policies
            if (rel === '.emdash' || rel.startsWith('.emdash' + path.sep))
                continue;
            result.push(rel);
            let entries = [];
            try {
                entries = fs.readdirSync(abs);
            }
            catch {
                continue;
            }
            for (const e of entries) {
                const nextRel = rel === '.' ? e : path.join(rel, e);
                stack.push(nextRel);
            }
        }
        else if (st.isFile()) {
            result.push(rel);
        }
    }
    return result;
}
function chmodNoWrite(mode, isDir) {
    const noWrite = mode & ~0o222; // clear write bits
    if (isDir) {
        // Ensure traverse bits present
        return (noWrite | 0o111) & 0o7777;
    }
    return noWrite & 0o7777;
}
function applyLock(root) {
    try {
        const entries = collectPaths(root);
        const state = [];
        let changed = 0;
        for (const rel of entries) {
            const abs = path.join(root, rel);
            let st;
            try {
                st = fs.statSync(abs);
            }
            catch {
                continue;
            }
            const isDir = st.isDirectory();
            const prevMode = st.mode & 0o7777;
            const nextMode = chmodNoWrite(prevMode, isDir);
            if (nextMode !== prevMode) {
                try {
                    fs.chmodSync(abs, nextMode);
                    state.push({ p: rel, m: prevMode });
                    changed++;
                }
                catch { }
            }
        }
        // Persist lock state
        const baseDir = path.join(root, '.emdash');
        try {
            fs.mkdirSync(baseDir, { recursive: true });
        }
        catch { }
        const statePath = path.join(baseDir, '.planlock.json');
        try {
            fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
        }
        catch { }
        return { success: true, changed };
    }
    catch (e) {
        return { success: false, changed: 0, error: e?.message || String(e) };
    }
}
function releaseLock(root) {
    try {
        const statePath = path.join(root, '.emdash', '.planlock.json');
        if (!fs.existsSync(statePath))
            return { success: true, restored: 0 };
        let raw = '';
        try {
            raw = fs.readFileSync(statePath, 'utf8');
        }
        catch { }
        let entries = [];
        try {
            entries = JSON.parse(raw || '[]');
        }
        catch { }
        let restored = 0;
        for (const ent of entries) {
            try {
                const abs = path.join(root, ent.p);
                fs.chmodSync(abs, ent.m);
                restored++;
            }
            catch { }
        }
        // Cleanup state file
        try {
            fs.unlinkSync(statePath);
        }
        catch { }
        return { success: true, restored };
    }
    catch (e) {
        return { success: false, restored: 0, error: e?.message || String(e) };
    }
}
function registerPlanLockIpc() {
    electron_1.ipcMain.handle('plan:lock', async (_e, taskPath) => {
        if (isWindows()) {
            // Best-effort: still attempt chmod; ACL hardening could be added with icacls in a future pass
            return applyLock(taskPath);
        }
        return applyLock(taskPath);
    });
    electron_1.ipcMain.handle('plan:unlock', async (_e, taskPath) => {
        if (isWindows()) {
            return releaseLock(taskPath);
        }
        return releaseLock(taskPath);
    });
}
