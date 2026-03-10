"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hostPreviewService = void 0;
const node_events_1 = require("node:events");
const node_child_process_1 = require("node:child_process");
const node_net_1 = __importDefault(require("node:net"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("../lib/logger");
function detectPackageManager(dir) {
    try {
        if (node_fs_1.default.existsSync(node_path_1.default.join(dir, 'pnpm-lock.yaml')))
            return 'pnpm';
        if (node_fs_1.default.existsSync(node_path_1.default.join(dir, 'yarn.lock')))
            return 'yarn';
        return 'npm';
    }
    catch {
        return 'npm';
    }
}
function normalizeUrl(u) {
    try {
        const re = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}(?:\/\S*)?)/i;
        const m = u.match(re);
        if (!m)
            return '';
        const url = new URL(m[1].replace('0.0.0.0', 'localhost'));
        url.hostname = 'localhost';
        return url.toString();
    }
    catch {
        return '';
    }
}
class HostPreviewService extends node_events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.procs = new Map();
        this.procCwds = new Map(); // Track cwd for each taskId
    }
    async setup(taskId, taskPath) {
        const cwd = node_path_1.default.resolve(taskPath);
        const pm = detectPackageManager(cwd);
        const cmd = pm;
        // Prefer clean install for npm when lockfile exists
        const hasPkgLock = node_fs_1.default.existsSync(node_path_1.default.join(cwd, 'package-lock.json'));
        const args = pm === 'npm' ? (hasPkgLock ? ['ci'] : ['install']) : ['install'];
        try {
            const child = (0, node_child_process_1.spawn)(cmd, args, {
                cwd,
                shell: true,
                env: { ...process.env, BROWSER: 'none' },
            });
            this.emit('event', { type: 'setup', taskId, status: 'starting' });
            const onData = (buf) => {
                const line = buf.toString();
                this.emit('event', {
                    type: 'setup',
                    taskId,
                    status: 'line',
                    line,
                });
            };
            child.stdout.on('data', onData);
            child.stderr.on('data', onData);
            await new Promise((resolve, reject) => {
                child.on('exit', (code) => {
                    if (code === 0)
                        resolve();
                    else
                        reject(new Error(`install exited with ${code}`));
                });
                child.on('error', reject);
            });
            this.emit('event', { type: 'setup', taskId, status: 'done' });
            return { ok: true };
        }
        catch (e) {
            this.emit('event', {
                type: 'setup',
                taskId,
                status: 'error',
                line: e?.message || String(e),
            });
            return { ok: false, error: e?.message || String(e) };
        }
    }
    async pickAvailablePort(preferred, host = '127.0.0.1') {
        const tryPort = (port) => new Promise((resolve) => {
            const server = node_net_1.default.createServer();
            server.once('error', () => resolve(false));
            server.listen(port, host, () => {
                try {
                    server.close(() => resolve(true));
                }
                catch {
                    resolve(false);
                }
            });
        });
        for (const p of preferred) {
            if (await tryPort(p))
                return p;
        }
        const ephemeral = await new Promise((resolve) => {
            const server = node_net_1.default.createServer();
            server.listen(0, host, () => {
                const addr = server.address();
                const port = typeof addr === 'object' && addr ? addr.port : 0;
                try {
                    server.close(() => resolve(port || 5173));
                }
                catch {
                    resolve(5173);
                }
            });
            server.once('error', () => resolve(5173));
        });
        return ephemeral || 5173;
    }
    async start(taskId, taskPath, opts) {
        const cwd = node_path_1.default.resolve(taskPath);
        // Log the resolved path to help debug worktree issues
        logger_1.log.info?.('[hostPreview] start', {
            taskId,
            taskPath,
            resolvedCwd: cwd,
            cwdExists: node_fs_1.default.existsSync(cwd),
            hasPackageJson: node_fs_1.default.existsSync(node_path_1.default.join(cwd, 'package.json')),
        });
        // Check if process already exists for this taskId
        const existingProc = this.procs.get(taskId);
        const existingCwd = this.procCwds.get(taskId);
        // If process exists, verify it's running from the correct directory
        if (existingProc) {
            // Check if process is still running
            try {
                // On Unix, signal 0 checks if process exists
                existingProc.kill(0);
                // Process is still running - check if cwd matches
                if (existingCwd && node_path_1.default.resolve(existingCwd) === cwd) {
                    logger_1.log.info?.('[hostPreview] reusing existing process', {
                        taskId,
                        cwd: existingCwd,
                    });
                    return { ok: true };
                }
                else {
                    // Process exists but is running from wrong directory - stop it
                    logger_1.log.info?.('[hostPreview] stopping process with wrong cwd', {
                        taskId,
                        oldCwd: existingCwd,
                        newCwd: cwd,
                    });
                    try {
                        existingProc.kill();
                    }
                    catch { }
                    this.procs.delete(taskId);
                    this.procCwds.delete(taskId);
                }
            }
            catch {
                // Process has exited - clean up
                this.procs.delete(taskId);
                this.procCwds.delete(taskId);
            }
        }
        const pm = detectPackageManager(cwd);
        // Preflight: if the task lacks node_modules but the parent has it, try linking
        try {
            const parent = (opts?.parentProjectPath || '').trim();
            if (parent) {
                const wsNm = node_path_1.default.join(cwd, 'node_modules');
                const parentNm = node_path_1.default.join(parent, 'node_modules');
                const wsExists = node_fs_1.default.existsSync(wsNm);
                const parentExists = node_fs_1.default.existsSync(parentNm);
                if (!wsExists && parentExists) {
                    try {
                        const linkType = process.platform === 'win32' ? 'junction' : 'dir';
                        node_fs_1.default.symlinkSync(parentNm, wsNm, linkType);
                        logger_1.log.info?.('[hostPreview] linked node_modules', {
                            taskId,
                            wsNm,
                            parentNm,
                            linkType,
                        });
                    }
                    catch (e) {
                        logger_1.log.warn?.('[hostPreview] failed to link node_modules; will rely on install if needed', e);
                    }
                }
            }
        }
        catch { }
        const pkgPath = node_path_1.default.join(cwd, 'package.json');
        let script = 'dev';
        if (opts?.script && typeof opts.script === 'string' && opts.script.trim()) {
            script = opts.script.trim();
        }
        else {
            try {
                const raw = node_fs_1.default.readFileSync(pkgPath, 'utf8');
                const pkg = JSON.parse(raw);
                const scripts = (pkg && pkg.scripts) || {};
                const prefs = ['dev', 'start', 'serve', 'preview'];
                for (const k of prefs) {
                    if (typeof scripts[k] === 'string') {
                        script = k;
                        break;
                    }
                }
            }
            catch { }
        }
        const cmd = pm;
        const args = pm === 'npm' ? ['run', script] : [script];
        const env = { ...process.env };
        // Auto-install if package.json exists and node_modules is missing
        try {
            const hasPkg = node_fs_1.default.existsSync(pkgPath);
            const hasNm = node_fs_1.default.existsSync(node_path_1.default.join(cwd, 'node_modules'));
            if (hasPkg && !hasNm) {
                const hasLock = node_fs_1.default.existsSync(node_path_1.default.join(cwd, 'package-lock.json'));
                const installArgs = pm === 'npm' ? (hasLock ? ['ci'] : ['install']) : ['install'];
                const inst = (0, node_child_process_1.spawn)(pm, installArgs, {
                    cwd,
                    shell: true,
                    env: { ...process.env, BROWSER: 'none' },
                });
                this.emit('event', { type: 'setup', taskId, status: 'starting' });
                const onData = (buf) => {
                    try {
                        this.emit('event', {
                            type: 'setup',
                            taskId,
                            status: 'line',
                            line: buf.toString(),
                        });
                    }
                    catch { }
                };
                inst.stdout.on('data', onData);
                inst.stderr.on('data', onData);
                await new Promise((resolve, reject) => {
                    inst.on('exit', (code) => {
                        code === 0 ? resolve() : reject(new Error(`install exited with ${code}`));
                    });
                    inst.on('error', reject);
                });
                this.emit('event', { type: 'setup', taskId, status: 'done' });
            }
        }
        catch { }
        // Choose a free port (avoid 3000)
        const preferred = [5173, 5174, 3001, 3002, 8080, 4200, 5500, 7000];
        let forcedPort = await this.pickAvailablePort(preferred);
        if (!env.PORT)
            env.PORT = String(forcedPort);
        if (!env.VITE_PORT)
            env.VITE_PORT = env.PORT;
        if (!env.BROWSER)
            env.BROWSER = 'none';
        // Add CLI flags for common frameworks based on scripts and dependencies
        try {
            const raw = node_fs_1.default.readFileSync(pkgPath, 'utf8');
            const pkg = JSON.parse(raw);
            const scripts = (pkg && pkg.scripts) || {};
            const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            const scriptCmd = String(scripts[script] || '').toLowerCase();
            const looksLikeNext = scriptCmd.includes('next') || 'next' in deps;
            const looksLikeVite = scriptCmd.includes('vite') || 'vite' in deps;
            const looksLikeWebpack = scriptCmd.includes('webpack-dev-server') || 'webpack-dev-server' in deps;
            const looksLikeAngular = /(^|\s)ng(\s|$)/.test(scriptCmd) || scriptCmd.includes('angular') || '@angular/cli' in deps;
            const extra = [];
            if (looksLikeNext)
                extra.push('-p', String(forcedPort));
            else if (looksLikeVite || looksLikeWebpack || looksLikeAngular)
                extra.push('--port', String(forcedPort));
            if (extra.length) {
                if (pm === 'npm')
                    args.push('--', ...extra);
                else
                    args.push(...extra);
            }
            logger_1.log.info?.('[hostPreview] start', {
                taskId,
                cwd,
                pm,
                cmd,
                args,
                script,
                port: forcedPort,
            });
        }
        catch {
            logger_1.log.info?.('[hostPreview] start', {
                taskId,
                cwd,
                pm,
                cmd,
                args,
                script,
                port: forcedPort,
            });
        }
        const tryStart = async (maxRetries = 3) => {
            try {
                const child = (0, node_child_process_1.spawn)(cmd, args, { cwd, env, shell: true });
                this.procs.set(taskId, child);
                this.procCwds.set(taskId, cwd); // Store the cwd for this process
                let urlEmitted = false;
                let sawAddrInUse = false;
                let candidateUrl = null;
                const startedAt = Date.now();
                const emitSetupLine = (line) => {
                    try {
                        this.emit('event', {
                            type: 'setup',
                            taskId,
                            status: 'line',
                            line,
                        });
                    }
                    catch { }
                };
                // Helper to probe and emit URL only when server is actually reachable
                const probeAndEmitUrl = async (urlToProbe) => {
                    if (urlEmitted)
                        return;
                    try {
                        const parsed = new URL(urlToProbe);
                        const host = parsed.hostname || 'localhost';
                        const port = Number(parsed.port || 0);
                        if (!port)
                            return;
                        // Quick TCP probe to verify server is ready
                        const socket = node_net_1.default.createConnection({ host, port }, () => {
                            try {
                                socket.destroy();
                            }
                            catch { }
                            if (!urlEmitted) {
                                urlEmitted = true;
                                try {
                                    this.emit('event', {
                                        type: 'url',
                                        taskId,
                                        url: urlToProbe,
                                    });
                                }
                                catch { }
                            }
                        });
                        socket.on('error', () => {
                            try {
                                socket.destroy();
                            }
                            catch { }
                        });
                    }
                    catch { }
                };
                const onData = (buf) => {
                    const line = buf.toString();
                    emitSetupLine(line);
                    if (/EADDRINUSE|address\s+already\s+in\s+use/i.test(line))
                        sawAddrInUse = true;
                    const url = normalizeUrl(line);
                    if (url && !urlEmitted) {
                        // Store candidate URL and probe before emitting
                        candidateUrl = url;
                        // Probe immediately when URL is found in logs
                        probeAndEmitUrl(url);
                    }
                };
                child.stdout.on('data', onData);
                child.stderr.on('data', onData);
                // Probe periodically; if reachable and not emitted from logs, synthesize URL
                const host = 'localhost';
                const probeInterval = setInterval(() => {
                    if (urlEmitted)
                        return;
                    // If we have a candidate URL from logs, probe that first
                    if (candidateUrl) {
                        probeAndEmitUrl(candidateUrl);
                        return;
                    }
                    // Otherwise, probe the expected port
                    const socket = node_net_1.default.createConnection({ host, port: Number(env.PORT) || forcedPort }, () => {
                        try {
                            socket.destroy();
                        }
                        catch { }
                        if (!urlEmitted) {
                            urlEmitted = true;
                            try {
                                this.emit('event', {
                                    type: 'url',
                                    taskId,
                                    url: `http://localhost:${Number(env.PORT) || forcedPort}`,
                                });
                            }
                            catch { }
                        }
                    });
                    socket.on('error', () => {
                        try {
                            socket.destroy();
                        }
                        catch { }
                    });
                }, 800);
                child.on('exit', async () => {
                    clearInterval(probeInterval);
                    this.procs.delete(taskId);
                    this.procCwds.delete(taskId); // Clean up cwd tracking
                    const runtimeMs = Date.now() - startedAt;
                    const quickFail = runtimeMs < 4000; // exited very quickly
                    if (!urlEmitted && (sawAddrInUse || quickFail) && maxRetries > 0) {
                        // pick next free port and retry
                        const exclude = new Set([Number(env.PORT) || forcedPort]);
                        const nextList = preferred.filter((p) => !exclude.has(p));
                        forcedPort = await this.pickAvailablePort(nextList.length ? nextList : preferred);
                        env.PORT = String(forcedPort);
                        env.VITE_PORT = env.PORT;
                        // rewrite CLI flags
                        const idx = args.lastIndexOf('-p');
                        const idxPort = args.lastIndexOf('--port');
                        if (idx >= 0 && idx + 1 < args.length)
                            args[idx + 1] = String(forcedPort);
                        else if (idxPort >= 0 && idxPort + 1 < args.length)
                            args[idxPort + 1] = String(forcedPort);
                        else if (pm === 'npm')
                            args.push('--', '-p', String(forcedPort));
                        else
                            args.push('-p', String(forcedPort));
                        logger_1.log.info?.('[hostPreview] retry on new port', {
                            taskId,
                            port: forcedPort,
                            retriesLeft: maxRetries - 1,
                        });
                        await tryStart(maxRetries - 1);
                        return;
                    }
                    try {
                        this.emit('event', { type: 'exit', taskId });
                    }
                    catch { }
                });
                return { ok: true };
            }
            catch (e) {
                logger_1.log.error('[hostPreview] failed to start', e);
                return { ok: false, error: e?.message || String(e) };
            }
        };
        return await tryStart(3);
    }
    stop(taskId) {
        const p = this.procs.get(taskId);
        if (!p)
            return { ok: true };
        try {
            p.kill();
        }
        catch { }
        this.procs.delete(taskId);
        this.procCwds.delete(taskId); // Clean up cwd tracking
        return { ok: true };
    }
    stopAll(exceptId) {
        const stopped = [];
        const except = (exceptId || '').trim();
        for (const [id, proc] of this.procs.entries()) {
            if (except && id === except)
                continue;
            try {
                proc.kill();
            }
            catch { }
            this.procs.delete(id);
            this.procCwds.delete(id); // Clean up cwd tracking
            stopped.push(id);
        }
        return { ok: true, stopped };
    }
    onEvent(listener) {
        this.on('event', listener);
        return () => this.off('event', listener);
    }
}
exports.hostPreviewService = new HostPreviewService();
