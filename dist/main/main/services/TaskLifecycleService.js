"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskLifecycleService = void 0;
const node_events_1 = require("node:events");
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const node_util_1 = require("node:util");
const LifecycleScriptsService_1 = require("./LifecycleScriptsService");
const lifecycle_1 = require("@shared/lifecycle");
const envVars_1 = require("@shared/task/envVars");
const logger_1 = require("../lib/logger");
const node_child_process_2 = require("node:child_process");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_2.execFile);
class TaskLifecycleService extends node_events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.states = new Map();
        this.logBuffers = new Map();
        this.runProcesses = new Map();
        this.finiteProcesses = new Map();
        this.runStartInflight = new Map();
        this.setupInflight = new Map();
        this.teardownInflight = new Map();
        this.stopIntents = new Set();
    }
    nowIso() {
        return new Date().toISOString();
    }
    inflightKey(taskId, taskPath) {
        return `${taskId}::${taskPath}`;
    }
    killProcessTree(proc, signal) {
        const pid = proc.pid;
        if (!pid)
            return;
        if (process.platform === 'win32') {
            const args = ['/PID', String(pid), '/T'];
            if (signal === 'SIGKILL') {
                args.push('/F');
            }
            const killer = (0, node_child_process_1.spawn)('taskkill', args, { stdio: 'ignore' });
            killer.unref();
            return;
        }
        try {
            // Detached shell commands run as their own process group.
            process.kill(-pid, signal);
        }
        catch {
            proc.kill(signal);
        }
    }
    trackFiniteProcess(taskId, proc) {
        const set = this.finiteProcesses.get(taskId) ?? new Set();
        set.add(proc);
        this.finiteProcesses.set(taskId, set);
        return () => {
            const current = this.finiteProcesses.get(taskId);
            if (!current)
                return;
            current.delete(proc);
            if (current.size === 0) {
                this.finiteProcesses.delete(taskId);
            }
        };
    }
    async resolveDefaultBranch(projectPath) {
        try {
            const { stdout } = await execFileAsync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: projectPath });
            const ref = stdout.trim();
            if (ref) {
                return ref.replace(/^origin\//, '');
            }
        }
        catch { }
        try {
            const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
                cwd: projectPath,
            });
            const branch = stdout.trim();
            if (branch && branch !== 'HEAD') {
                return branch;
            }
        }
        catch { }
        return 'main';
    }
    async buildLifecycleEnv(taskId, taskPath, projectPath, taskName) {
        const defaultBranch = await this.resolveDefaultBranch(projectPath);
        taskName = taskName || node_path_1.default.basename(taskPath) || taskId;
        const taskEnv = (0, envVars_1.getTaskEnvVars)({
            taskId,
            taskName,
            taskPath,
            projectPath,
            defaultBranch,
            portSeed: taskPath || taskId,
        });
        return { ...process.env, ...taskEnv };
    }
    createPhaseState() {
        return { status: 'idle', error: null, exitCode: null };
    }
    defaultState(taskId) {
        return {
            taskId,
            setup: this.createPhaseState(),
            run: { ...this.createPhaseState(), pid: null },
            teardown: this.createPhaseState(),
        };
    }
    ensureState(taskId) {
        const existing = this.states.get(taskId);
        if (existing)
            return existing;
        const state = this.defaultState(taskId);
        this.states.set(taskId, state);
        return state;
    }
    ensureLogBuffer(taskId) {
        const existing = this.logBuffers.get(taskId);
        if (existing)
            return existing;
        const buf = { setup: [], run: [], teardown: [] };
        this.logBuffers.set(taskId, buf);
        return buf;
    }
    appendLog(taskId, phase, line) {
        const buf = this.ensureLogBuffer(taskId);
        const arr = buf[phase];
        arr.push(line);
        if (arr.length > lifecycle_1.MAX_LIFECYCLE_LOG_LINES) {
            arr.splice(0, arr.length - lifecycle_1.MAX_LIFECYCLE_LOG_LINES);
        }
    }
    buildErrorDetail(taskId, phase, baseError) {
        const buf = this.logBuffers.get(taskId);
        const lines = buf?.[phase] ?? [];
        // Grab last few non-empty output lines for context
        const tail = lines
            .map((l) => l.replace(/^\[.*?\]\s*/, '').trim())
            .filter(Boolean)
            .slice(-5);
        if (tail.length === 0)
            return baseError;
        return `${baseError}\n${tail.join('\n')}`;
    }
    emitLifecycleEvent(taskId, phase, status, extras) {
        const evt = {
            taskId,
            phase,
            status,
            timestamp: this.nowIso(),
            ...(extras || {}),
        };
        // Buffer log lines so they survive task switches in the renderer
        const line = (0, lifecycle_1.formatLifecycleLogLine)(phase, status, extras);
        if (line !== null) {
            this.appendLog(taskId, phase, line);
        }
        this.emit('event', evt);
    }
    runFinite(taskId, taskPath, projectPath, phase, taskName) {
        const script = LifecycleScriptsService_1.lifecycleScriptsService.getScript(projectPath, phase);
        if (!script)
            return Promise.resolve({ ok: true, skipped: true });
        const state = this.ensureState(taskId);
        state[phase] = {
            status: 'running',
            startedAt: this.nowIso(),
            finishedAt: undefined,
            exitCode: null,
            error: null,
        };
        this.emitLifecycleEvent(taskId, phase, 'starting');
        return new Promise((resolve) => {
            void (async () => {
                let settled = false;
                const finish = (result, nextState) => {
                    if (settled)
                        return;
                    settled = true;
                    state[phase] = nextState;
                    resolve(result);
                };
                try {
                    const env = await this.buildLifecycleEnv(taskId, taskPath, projectPath, taskName);
                    const child = (0, node_child_process_1.spawn)(script, {
                        cwd: taskPath,
                        shell: true,
                        env,
                        detached: true,
                    });
                    const untrackFinite = this.trackFiniteProcess(taskId, child);
                    const onData = (buf) => {
                        const line = buf.toString();
                        this.emitLifecycleEvent(taskId, phase, 'line', { line });
                    };
                    child.stdout?.on('data', onData);
                    child.stderr?.on('data', onData);
                    child.on('error', (error) => {
                        untrackFinite();
                        const message = error?.message || String(error);
                        this.emitLifecycleEvent(taskId, phase, 'error', { error: message });
                        const detail = this.buildErrorDetail(taskId, phase, message);
                        finish({ ok: false, error: detail }, {
                            ...state[phase],
                            status: 'failed',
                            finishedAt: this.nowIso(),
                            error: message,
                        });
                    });
                    child.on('exit', (code) => {
                        untrackFinite();
                        const ok = code === 0;
                        this.emitLifecycleEvent(taskId, phase, ok ? 'done' : 'error', {
                            exitCode: code,
                            ...(ok ? {} : { error: `Exited with code ${String(code)}` }),
                        });
                        const errorMsg = `Exited with code ${String(code)}`;
                        const detail = ok ? undefined : this.buildErrorDetail(taskId, phase, errorMsg);
                        finish(ok ? { ok: true } : { ok: false, error: detail }, {
                            ...state[phase],
                            status: ok ? 'succeeded' : 'failed',
                            finishedAt: this.nowIso(),
                            exitCode: code,
                            error: ok ? null : errorMsg,
                        });
                    });
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    this.emitLifecycleEvent(taskId, phase, 'error', { error: message });
                    finish({ ok: false, error: message }, {
                        ...state[phase],
                        status: 'failed',
                        finishedAt: this.nowIso(),
                        error: message,
                    });
                }
            })();
        });
    }
    async runSetup(taskId, taskPath, projectPath, taskName) {
        const key = this.inflightKey(taskId, taskPath);
        if (this.setupInflight.has(key)) {
            return this.setupInflight.get(key);
        }
        const run = this.runFinite(taskId, taskPath, projectPath, 'setup', taskName).finally(() => {
            this.setupInflight.delete(key);
        });
        this.setupInflight.set(key, run);
        return run;
    }
    async startRun(taskId, taskPath, projectPath, taskName) {
        const inflight = this.runStartInflight.get(taskId);
        if (inflight)
            return inflight;
        const run = this.startRunInternal(taskId, taskPath, projectPath, taskName).finally(() => {
            if (this.runStartInflight.get(taskId) === run) {
                this.runStartInflight.delete(taskId);
            }
        });
        this.runStartInflight.set(taskId, run);
        return run;
    }
    async startRunInternal(taskId, taskPath, projectPath, taskName) {
        const setupScript = LifecycleScriptsService_1.lifecycleScriptsService.getScript(projectPath, 'setup');
        if (setupScript) {
            const setupStatus = this.ensureState(taskId).setup.status;
            if (setupStatus === 'idle' || setupStatus === 'failed') {
                logger_1.log.info(`Auto-running setup before run (state was ${setupStatus})`, { taskId });
                const setupResult = await this.runSetup(taskId, taskPath, projectPath, taskName);
                if (!setupResult.ok) {
                    return { ok: false, error: `Setup failed: ${setupResult.error}` };
                }
            }
            else if (setupStatus === 'running') {
                return { ok: false, error: 'Setup is still running' };
            }
        }
        const script = LifecycleScriptsService_1.lifecycleScriptsService.getScript(projectPath, 'run');
        if (!script)
            return { ok: true, skipped: true };
        const existing = this.runProcesses.get(taskId);
        if (existing &&
            existing.exitCode === null &&
            !existing.killed &&
            !this.stopIntents.has(taskId)) {
            return { ok: true, skipped: true };
        }
        // Clear any residual stop intent so the new process's exit is not misclassified.
        this.stopIntents.delete(taskId);
        const state = this.ensureState(taskId);
        state.run = {
            status: 'running',
            startedAt: this.nowIso(),
            finishedAt: undefined,
            exitCode: null,
            error: null,
            pid: null,
        };
        this.emitLifecycleEvent(taskId, 'run', 'starting');
        try {
            const env = await this.buildLifecycleEnv(taskId, taskPath, projectPath, taskName);
            const child = (0, node_child_process_1.spawn)(script, {
                cwd: taskPath,
                shell: true,
                env,
                detached: true,
            });
            this.runProcesses.set(taskId, child);
            state.run.pid = child.pid ?? null;
            const onData = (buf) => {
                const line = buf.toString();
                this.emitLifecycleEvent(taskId, 'run', 'line', { line });
            };
            child.stdout?.on('data', onData);
            child.stderr?.on('data', onData);
            child.on('error', (error) => {
                if (this.runProcesses.get(taskId) !== child)
                    return;
                this.runProcesses.delete(taskId);
                this.stopIntents.delete(taskId);
                const message = error?.message || String(error);
                const cur = this.ensureState(taskId);
                cur.run = {
                    ...cur.run,
                    status: 'failed',
                    finishedAt: this.nowIso(),
                    error: message,
                };
                this.emitLifecycleEvent(taskId, 'run', 'error', { error: message });
            });
            child.on('exit', (code) => {
                if (this.runProcesses.get(taskId) !== child)
                    return;
                this.runProcesses.delete(taskId);
                const wasStopped = this.stopIntents.has(taskId);
                this.stopIntents.delete(taskId);
                const cur = this.ensureState(taskId);
                cur.run = {
                    ...cur.run,
                    status: wasStopped ? 'idle' : code === 0 ? 'succeeded' : 'failed',
                    finishedAt: this.nowIso(),
                    exitCode: code,
                    pid: null,
                    error: wasStopped || code === 0 ? null : `Exited with code ${String(code)}`,
                };
                this.emitLifecycleEvent(taskId, 'run', 'exit', { exitCode: code });
            });
            return { ok: true };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            state.run = {
                ...state.run,
                status: 'failed',
                finishedAt: this.nowIso(),
                error: message,
                pid: null,
            };
            this.emitLifecycleEvent(taskId, 'run', 'error', { error: message });
            return { ok: false, error: message };
        }
    }
    stopRun(taskId) {
        const proc = this.runProcesses.get(taskId);
        if (!proc)
            return { ok: true, skipped: true };
        this.stopIntents.add(taskId);
        try {
            this.killProcessTree(proc, 'SIGTERM');
            setTimeout(() => {
                const current = this.runProcesses.get(taskId);
                if (!current || current !== proc)
                    return;
                this.killProcessTree(proc, 'SIGKILL');
            }, 8000);
            return { ok: true };
        }
        catch (error) {
            this.stopIntents.delete(taskId);
            const message = error instanceof Error ? error.message : String(error);
            const cur = this.ensureState(taskId);
            cur.run = {
                ...cur.run,
                status: 'failed',
                finishedAt: this.nowIso(),
                error: message,
            };
            logger_1.log.warn('Failed to stop run process', { taskId, error: message });
            return { ok: false, error: message };
        }
    }
    async runTeardown(taskId, taskPath, projectPath, taskName) {
        const key = this.inflightKey(taskId, taskPath);
        if (this.teardownInflight.has(key)) {
            return this.teardownInflight.get(key);
        }
        const run = (async () => {
            // Serialize teardown behind setup for this task/worktree key.
            const setupRun = this.setupInflight.get(key);
            if (setupRun) {
                await setupRun.catch(() => { });
            }
            // Ensure a managed run process is stopped before teardown starts.
            const existingRun = this.runProcesses.get(taskId);
            if (existingRun) {
                this.stopRun(taskId);
                await new Promise((resolve) => {
                    let done = false;
                    const finish = () => {
                        if (done)
                            return;
                        done = true;
                        resolve();
                    };
                    const timer = setTimeout(() => {
                        logger_1.log.warn('Timed out waiting for run process to exit before teardown', { taskId });
                        finish();
                    }, 10000);
                    existingRun.once('exit', () => {
                        clearTimeout(timer);
                        finish();
                    });
                });
            }
            return this.runFinite(taskId, taskPath, projectPath, 'teardown', taskName);
        })().finally(() => {
            this.teardownInflight.delete(key);
        });
        this.teardownInflight.set(key, run);
        return run;
    }
    getState(taskId) {
        return this.ensureState(taskId);
    }
    getLogs(taskId) {
        const buf = this.logBuffers.get(taskId);
        return buf
            ? { setup: [...buf.setup], run: [...buf.run], teardown: [...buf.teardown] }
            : { setup: [], run: [], teardown: [] };
    }
    clearTask(taskId) {
        this.states.delete(taskId);
        this.logBuffers.delete(taskId);
        this.stopIntents.delete(taskId);
        this.runStartInflight.delete(taskId);
        const prefix = `${taskId}::`;
        for (const key of this.setupInflight.keys()) {
            if (key.startsWith(prefix)) {
                this.setupInflight.delete(key);
            }
        }
        for (const key of this.teardownInflight.keys()) {
            if (key.startsWith(prefix)) {
                this.teardownInflight.delete(key);
            }
        }
        const proc = this.runProcesses.get(taskId);
        if (proc) {
            try {
                this.killProcessTree(proc, 'SIGTERM');
            }
            catch { }
            this.runProcesses.delete(taskId);
        }
        const finite = this.finiteProcesses.get(taskId);
        if (finite) {
            for (const child of finite) {
                try {
                    this.killProcessTree(child, 'SIGTERM');
                }
                catch { }
            }
            this.finiteProcesses.delete(taskId);
        }
    }
    shutdown() {
        for (const [taskId, proc] of this.runProcesses.entries()) {
            try {
                this.stopIntents.add(taskId);
                this.killProcessTree(proc, 'SIGTERM');
            }
            catch { }
        }
        for (const procs of this.finiteProcesses.values()) {
            for (const proc of procs) {
                try {
                    this.killProcessTree(proc, 'SIGTERM');
                }
                catch { }
            }
        }
        this.runProcesses.clear();
        this.finiteProcesses.clear();
        this.runStartInflight.clear();
        this.setupInflight.clear();
        this.teardownInflight.clear();
    }
    onEvent(listener) {
        this.on('event', listener);
        return () => this.off('event', listener);
    }
}
exports.taskLifecycleService = new TaskLifecycleService();
