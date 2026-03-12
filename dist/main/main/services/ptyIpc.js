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
exports.registerPtyIpc = registerPtyIpc;
const electron_1 = require("electron");
const ptyManager_1 = require("./ptyManager");
const logger_1 = require("../lib/logger");
const TerminalSnapshotService_1 = require("./TerminalSnapshotService");
const errorTracking_1 = require("../errorTracking");
const telemetry = __importStar(require("../telemetry"));
const registry_1 = require("../../shared/providers/registry");
const ptyId_1 = require("../../shared/ptyId");
const TerminalConfigParser_1 = require("./TerminalConfigParser");
const ClaudeHookService_1 = require("./ClaudeHookService");
const DatabaseService_1 = require("./DatabaseService");
const LifecycleScriptsService_1 = require("./LifecycleScriptsService");
const ClaudeConfigService_1 = require("./ClaudeConfigService");
const OpenCodeHookService_1 = require("./OpenCodeHookService");
const drizzleClient_1 = require("../db/drizzleClient");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const path_1 = __importDefault(require("path"));
const shellEscape_1 = require("../utils/shellEscape");
const AgentEventService_1 = require("./AgentEventService");
const CodexSessionService_1 = require("./CodexSessionService");
const waitForShellPrompt_1 = require("../utils/waitForShellPrompt");
const owners = new Map();
const listeners = new Set();
const promptHandles = new Map();
function cancelPromptHandles(id) {
    const handles = promptHandles.get(id);
    if (handles) {
        for (const h of handles)
            h.cancel();
        promptHandles.delete(id);
    }
}
function waitForSshPromptThenWrite(id, proc, data, label) {
    const handles = promptHandles.get(id) ?? [];
    promptHandles.set(id, handles);
    const handle = (0, waitForShellPrompt_1.waitForShellPrompt)({
        subscribe: (cb) => {
            const disposable = proc.onData(cb);
            return () => disposable.dispose();
        },
        write: (d) => {
            proc.write(d);
            promptHandles.delete(id);
        },
        data,
        onTimeout: () => logger_1.log.warn(`${label} SSH shell prompt not detected, writing init commands anyway`, { id }),
    });
    handles.push(handle);
}
const providerPtyTimers = new Map();
// Map PTY IDs to provider IDs for multi-agent tracking
const ptyProviderMap = new Map();
// Prevent duplicate finish handling when cleanup and onExit race for the same PTY.
const finalizedPtys = new Set();
// Track WebContents that have a 'destroyed' listener to avoid duplicates
const wcDestroyedListeners = new Set();
let isAppQuitting = false;
// Buffer PTY output to reduce IPC overhead.
// Uses setImmediate for first chunk (near-zero latency) and falls back to a
// short timer only when data arrives continuously at high throughput.
const ptyDataBuffers = new Map();
const ptyDataTimers = new Map();
const PTY_DATA_FLUSH_MS = 8; // Only used for high-throughput batching fallback
const PTY_ACTIVITY_SAMPLE_CHARS = 8192;
// Separate throttle for pty:activity messages (does not block pty:data)
const PTY_ACTIVITY_THROTTLE_MS = 200;
const ptyActivityTimers = new Map();
const ptyActivityPending = new Map();
const CODEX_BIND_LOOKBACK_MS = 15000;
const CODEX_BIND_TIMEOUT_MS = 20000;
const CODEX_BIND_POLL_MS = 250;
const codexBindingQueues = new Map();
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function pruneInvalidCodexResumeTarget(ptyId, cwd, resume) {
    if (!resume)
        return;
    const exactTarget = (0, ptyManager_1.getStoredResumeTarget)(ptyId, 'codex', cwd);
    if (!exactTarget)
        return;
    const valid = await CodexSessionService_1.codexSessionService.threadExistsForCwd(exactTarget, cwd);
    if (valid)
        return;
    (0, ptyManager_1.clearStoredSession)(ptyId);
    logger_1.log.warn('ptyIpc: pruned stale Codex resume target', { ptyId, cwd, exactTarget });
}
async function bindCodexThreadForPty(ptyId, cwd, startedAt) {
    if ((0, ptyManager_1.getStoredResumeTarget)(ptyId, 'codex', cwd)) {
        logger_1.log.info('ptyIpc: skipping Codex bind because PTY already has a stored target', {
            ptyId,
            cwd,
        });
        return;
    }
    const deadline = Date.now() + CODEX_BIND_TIMEOUT_MS;
    const since = startedAt - CODEX_BIND_LOOKBACK_MS;
    let attempts = 0;
    logger_1.log.info('ptyIpc: starting Codex thread bind', {
        ptyId,
        cwd,
        startedAt,
        since,
        timeoutMs: CODEX_BIND_TIMEOUT_MS,
        lookbackMs: CODEX_BIND_LOOKBACK_MS,
    });
    const existingThread = await CodexSessionService_1.codexSessionService.findLatestThreadForCwd(cwd);
    if (existingThread) {
        (0, ptyManager_1.markCodexSessionBound)(ptyId, existingThread.id, cwd);
        logger_1.log.info('ptyIpc: bound Codex PTY to existing exact-cwd thread', {
            ptyId,
            cwd,
            threadId: existingThread.id,
            updatedAt: existingThread.updatedAt,
        });
        return;
    }
    while (Date.now() <= deadline) {
        attempts += 1;
        const thread = await CodexSessionService_1.codexSessionService.findLatestRecentThreadForCwd(cwd, since);
        if (thread || attempts <= 3 || attempts % 10 === 0) {
            logger_1.log.info('ptyIpc: Codex bind poll result', {
                ptyId,
                cwd,
                attempt: attempts,
                candidateThreadId: thread?.id ?? null,
                candidateUpdatedAt: thread?.updatedAt ?? null,
            });
        }
        if (thread) {
            (0, ptyManager_1.markCodexSessionBound)(ptyId, thread.id, cwd);
            logger_1.log.info('ptyIpc: bound Codex PTY to thread', { ptyId, cwd, threadId: thread.id });
            return;
        }
        await sleep(CODEX_BIND_POLL_MS);
    }
    const latestThread = await CodexSessionService_1.codexSessionService.findLatestThreadForCwd(cwd);
    if (latestThread) {
        (0, ptyManager_1.markCodexSessionBound)(ptyId, latestThread.id, cwd);
        logger_1.log.info('ptyIpc: bound Codex PTY to latest exact-cwd thread after polling timeout', {
            ptyId,
            cwd,
            attempts,
            threadId: latestThread.id,
            updatedAt: latestThread.updatedAt,
        });
        return;
    }
    logger_1.log.info('ptyIpc: no Codex thread discovered for PTY', {
        ptyId,
        cwd,
        attempts,
        latestThreadId: null,
        latestThreadUpdatedAt: null,
        latestThreadCreatedAt: null,
        latestThreadArchived: null,
    });
}
function scheduleCodexThreadBinding(ptyId, cwd, startedAt) {
    if ((0, ptyManager_1.getStoredResumeTarget)(ptyId, 'codex', cwd)) {
        logger_1.log.info('ptyIpc: not scheduling Codex bind because exact target already exists', {
            ptyId,
            cwd,
        });
        return;
    }
    const queueKey = `codex:${cwd}`;
    const previous = codexBindingQueues.get(queueKey) ?? Promise.resolve();
    logger_1.log.info('ptyIpc: scheduling Codex bind', {
        ptyId,
        cwd,
        queueKey,
        queuedBehindExistingBind: codexBindingQueues.has(queueKey),
    });
    const next = previous
        .catch(() => { })
        .then(() => bindCodexThreadForPty(ptyId, cwd, startedAt))
        .catch((error) => {
        logger_1.log.warn('ptyIpc: failed to bind Codex thread', {
            ptyId,
            cwd,
            error: String(error),
        });
    })
        .finally(() => {
        if (codexBindingQueues.get(queueKey) === next) {
            codexBindingQueues.delete(queueKey);
        }
    });
    codexBindingQueues.set(queueKey, next);
}
// Guard IPC sends to prevent crashes when WebContents is destroyed
function safeSendToOwner(id, channel, payload) {
    const wc = owners.get(id);
    if (!wc)
        return false;
    try {
        if (typeof wc.isDestroyed === 'function' && wc.isDestroyed())
            return false;
        wc.send(channel, payload);
        return true;
    }
    catch (err) {
        logger_1.log.warn('ptyIpc:safeSendFailed', {
            id,
            channel,
            error: String(err?.message || err),
        });
        return false;
    }
}
function sendPtyExitGlobal(id) {
    safeSendToOwner(id, 'pty:exit:global', { id });
}
function flushPtyData(id) {
    const buf = ptyDataBuffers.get(id);
    if (!buf)
        return;
    ptyDataBuffers.delete(id);
    // Send data to renderer immediately — this is the latency-critical path
    safeSendToOwner(id, `pty:data:${id}`, buf);
    // Activity classification is sent on a separate throttled channel
    scheduleActivityUpdate(id, buf);
}
/** Throttled activity updates — decoupled from the data path to avoid doubling IPC per flush */
function scheduleActivityUpdate(id, chunk) {
    // Always keep the latest chunk for when the timer fires
    const prev = ptyActivityPending.get(id) || '';
    const merged = prev + chunk;
    ptyActivityPending.set(id, merged.length <= PTY_ACTIVITY_SAMPLE_CHARS ? merged : merged.slice(-PTY_ACTIVITY_SAMPLE_CHARS));
    if (ptyActivityTimers.has(id))
        return;
    const t = setTimeout(() => {
        ptyActivityTimers.delete(id);
        const sample = ptyActivityPending.get(id);
        ptyActivityPending.delete(id);
        if (sample) {
            safeSendToOwner(id, 'pty:activity', { id, chunk: sample });
        }
    }, PTY_ACTIVITY_THROTTLE_MS);
    ptyActivityTimers.set(id, t);
}
function clearPtyData(id) {
    const t = ptyDataTimers.get(id);
    if (t) {
        clearTimeout(t);
        ptyDataTimers.delete(id);
    }
    ptyDataBuffers.delete(id);
    // Also clean up activity throttle state
    const at = ptyActivityTimers.get(id);
    if (at) {
        clearTimeout(at);
        ptyActivityTimers.delete(id);
    }
    ptyActivityPending.delete(id);
}
function cleanupPtySession(id) {
    // Ensure telemetry timers are cleared even on manual kill
    maybeMarkProviderFinish(id, null, undefined, 'manual_kill');
    sendPtyExitGlobal(id);
    // Kill associated tmux session if this PTY was tmux-wrapped
    if ((0, ptyManager_1.getPtyTmuxSessionName)(id)) {
        (0, ptyManager_1.killTmuxSession)(id);
    }
    (0, ptyManager_1.killPty)(id);
    owners.delete(id);
    listeners.delete(id);
}
function bufferedSendPtyData(id, chunk) {
    const prev = ptyDataBuffers.get(id) || '';
    ptyDataBuffers.set(id, prev + chunk);
    if (ptyDataTimers.has(id))
        return;
    // Use setImmediate for the first chunk — flushes at the end of the current
    // I/O cycle (~0-1ms) instead of waiting a full 16ms timer tick.  Subsequent
    // chunks that arrive in the same tick are automatically coalesced because the
    // timer guard above prevents scheduling a second flush.
    //
    // For sustained high-throughput (e.g. `cat bigfile`), the write callback from
    // node-pty fires many times per tick, so the coalescing still provides
    // batching without adding latency to interactive keystrokes.
    const t = setImmediate(() => {
        ptyDataTimers.delete(id);
        const buf = ptyDataBuffers.get(id) || '';
        // If a very large burst accumulated, flush now but schedule a short timer
        // for the next wave to avoid flooding the IPC channel.
        if (buf.length > 65536) {
            flushPtyData(id);
            // Briefly switch to timer-based batching for the remainder of the burst
            if (ptyDataBuffers.has(id)) {
                const bt = setTimeout(() => {
                    ptyDataTimers.delete(id);
                    flushPtyData(id);
                }, PTY_DATA_FLUSH_MS);
                ptyDataTimers.set(id, bt);
            }
        }
        else {
            flushPtyData(id);
        }
    });
    ptyDataTimers.set(id, t);
}
/**
 * Deterministic port in the ephemeral range (49152–65535) derived from ptyId.
 * Used for the reverse SSH tunnel so the remote hook can reach the local
 * AgentEventService.
 */
function pickReverseTunnelPort(ptyId) {
    const hash = (0, crypto_1.createHash)('sha256').update(ptyId).digest();
    const value = hash.readUInt16BE(0); // 0–65535
    return 49152 + (value % (65535 - 49152 + 1));
}
/**
 * Write `.claude/settings.local.json` on the remote with Notification and Stop
 * hook entries, merging with any existing content (same logic as
 * `ClaudeHookService.writeHookConfig` locally).
 *
 * Combines read + merge + write into a SINGLE ssh exec call to cut startup
 * latency from ~2-10s (two sequential SSH connections) to ~0.5-2s (one call).
 */
async function writeRemoteHookConfig(sshArgs, sshTarget, cwd) {
    const dir = `${cwd}/.claude`;
    const filePath = `${dir}/settings.local.json`;
    // Build the hook entries that need to be merged
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hookTemplate = {};
    ClaudeHookService_1.ClaudeHookService.mergeHookEntries(hookTemplate);
    const hookJson = JSON.stringify(hookTemplate);
    // Single SSH exec: read existing config, merge hook entries, write back.
    // Uses a Python one-liner (available on virtually all Linux servers) to
    // do a deep-ish merge: existing values are preserved, hook entries are
    // added/updated.  Falls back to a pure-shell approach if Python isn't
    // available.
    const remoteScript = [
        `mkdir -p ${(0, shellEscape_1.quoteShellArg)(dir)}`,
        `python3 -c '`,
        `import json,sys,os`,
        `p=${(0, shellEscape_1.quoteShellArg)(filePath)}`,
        `h=json.loads(sys.argv[1])`,
        `try:`,
        `  e=json.load(open(p)) if os.path.isfile(p) else {}`,
        `except: e={}`,
        `e.update(h)`,
        `open(p,"w").write(json.dumps(e,indent=2)+"\\n")`,
        `' ${(0, shellEscape_1.quoteShellArg)(hookJson)}`,
        `2>/dev/null`,
        `|| printf '%s\\n' ${(0, shellEscape_1.quoteShellArg)(JSON.stringify(hookTemplate, null, 2))} > ${(0, shellEscape_1.quoteShellArg)(filePath)}`,
    ].join(' ');
    await execFileAsync('ssh', [...sshArgs, sshTarget, remoteScript]);
}
async function writeRemoteOpenCodePlugin(sshArgs, sshTarget, ptyId) {
    const configDir = OpenCodeHookService_1.OpenCodeHookService.getRemoteConfigDir(ptyId);
    const pluginsDir = `${configDir}/plugins`;
    const pluginPath = `${pluginsDir}/${OpenCodeHookService_1.OPEN_CODE_PLUGIN_FILE}`;
    const pluginSource = OpenCodeHookService_1.OpenCodeHookService.getPluginSource();
    await execFileAsync('ssh', [
        ...sshArgs,
        sshTarget,
        `mkdir -p "${pluginsDir}" && printf '%s\\n' ${(0, shellEscape_1.quoteShellArg)(pluginSource)} > "${pluginPath}"`,
    ]);
    return configDir;
}
function buildRemoteInitKeystrokes(args) {
    const lines = [];
    if (args.cwd) {
        // Keep this line shell-agnostic (works in zsh/bash/fish); avoid POSIX `||` which fish doesn't support.
        // If `cd` fails, the shell will print its own error message.
        lines.push(`cd ${(0, shellEscape_1.quoteShellArg)(args.cwd)}`);
    }
    // Insert any pre-provider setup commands (e.g. export statements for hook env vars)
    if (args.preProviderCommands?.length) {
        lines.push(...args.preProviderCommands);
    }
    if (args.provider) {
        const cli = args.provider.cli;
        const install = args.provider.installCommand ? ` Install: ${args.provider.installCommand}` : '';
        const msg = `emdash: ${cli} not found on remote.${install}`;
        const providerCmd = args.provider.cmd;
        if (args.tmux) {
            // When tmux is enabled, wrap the provider command in a named tmux session.
            // tmux new-session -As creates-or-attaches in one command.
            // Falls back to running without tmux if tmux isn't installed on the remote.
            const tmuxName = (0, shellEscape_1.quoteShellArg)(args.tmux.sessionName);
            const shScript = `if command -v ${(0, shellEscape_1.quoteShellArg)(cli)} >/dev/null 2>&1; then if command -v tmux >/dev/null 2>&1; then exec tmux new-session -As ${tmuxName} -- sh -c ${(0, shellEscape_1.quoteShellArg)(providerCmd)}; else printf '%s\\n' 'emdash: tmux not found on remote, running without session persistence'; exec ${providerCmd}; fi; else printf '%s\\n' ${(0, shellEscape_1.quoteShellArg)(msg)}; fi`;
            lines.push(`sh -ilc ${(0, shellEscape_1.quoteShellArg)(shScript)}`);
        }
        else {
            const shScript = `if command -v ${(0, shellEscape_1.quoteShellArg)(cli)} >/dev/null 2>&1; then exec ${providerCmd}; else printf '%s\\n' ${(0, shellEscape_1.quoteShellArg)(msg)}; fi`;
            lines.push(`sh -ilc ${(0, shellEscape_1.quoteShellArg)(shScript)}`);
        }
    }
    return lines.length ? `${lines.join('\n')}\n` : '';
}
async function resolveSshInvocation(connectionId) {
    // If created from ssh config selection, prefer using the alias so OpenSSH config
    // (ProxyJump, UseKeychain, etc.) is honored by system ssh.
    if (connectionId.startsWith('ssh-config:')) {
        const raw = connectionId.slice('ssh-config:'.length);
        let alias = raw;
        try {
            // New scheme uses encodeURIComponent.
            if (/%[0-9A-Fa-f]{2}/.test(raw)) {
                alias = decodeURIComponent(raw);
            }
        }
        catch {
            alias = raw;
        }
        if (alias) {
            return { target: alias, args: [] };
        }
    }
    const { db } = await (0, drizzleClient_1.getDrizzleClient)();
    const rows = await db
        .select({
        id: schema_1.sshConnections.id,
        host: schema_1.sshConnections.host,
        port: schema_1.sshConnections.port,
        username: schema_1.sshConnections.username,
        privateKeyPath: schema_1.sshConnections.privateKeyPath,
    })
        .from(schema_1.sshConnections)
        .where((0, drizzle_orm_1.eq)(schema_1.sshConnections.id, connectionId))
        .limit(1);
    const row = rows[0];
    if (!row) {
        throw new Error(`SSH connection not found: ${connectionId}`);
    }
    const args = [];
    if (row.port && row.port !== 22) {
        args.push('-p', String(row.port));
    }
    if (row.privateKeyPath) {
        args.push('-i', row.privateKeyPath);
    }
    const target = row.username ? `${row.username}@${row.host}` : row.host;
    return { target, args };
}
function buildRemoteProviderInvocation(args) {
    const { providerId, autoApprove, initialPrompt, resume, id, cwd, ownerTaskId } = args;
    const fallbackProvider = (0, registry_1.getProvider)(providerId);
    const resolvedConfig = (0, ptyManager_1.resolveProviderCommandConfig)(providerId);
    const provider = resolvedConfig?.provider ?? fallbackProvider;
    const cliCommand = (resolvedConfig?.cli ||
        fallbackProvider?.cli ||
        providerId.toLowerCase()).trim();
    const parsedCliParts = (0, ptyManager_1.parseShellArgs)(cliCommand);
    const cliCommandParts = parsedCliParts.length > 0 ? parsedCliParts : [cliCommand];
    const cliCheckCommand = cliCommandParts[0];
    const cliArgs = [];
    // Apply per-task session isolation FIRST, before generic resume flags.
    // When session isolation succeeds (returns true), it adds --resume <uuid> or
    // --session-id <uuid>, and we must skip the generic resume flag (e.g. -c -r)
    // to avoid conflicts. This mirrors the logic in startDirectPty/startPty.
    let usedSessionIsolation = false;
    if (id && cwd && provider) {
        usedSessionIsolation = (0, ptyManager_1.applySessionIsolation)(cliArgs, provider, id, cwd, !!resume, ownerTaskId, true);
    }
    cliArgs.push(...(0, ptyManager_1.buildProviderCliArgs)({
        resume: !usedSessionIsolation && !!resume,
        resumeFlag: resolvedConfig?.resumeFlag ?? fallbackProvider?.resumeFlag,
        defaultArgs: resolvedConfig?.defaultArgs ?? fallbackProvider?.defaultArgs,
        extraArgs: resolvedConfig?.extraArgs,
        autoApprove,
        autoApproveFlag: resolvedConfig?.autoApproveFlag ?? fallbackProvider?.autoApproveFlag,
        initialPrompt,
        initialPromptFlag: resolvedConfig?.initialPromptFlag ?? fallbackProvider?.initialPromptFlag,
        useKeystrokeInjection: provider?.useKeystrokeInjection,
    }));
    cliArgs.push(...(0, ptyManager_1.getProviderRuntimeCliArgs)({ providerId, target: 'remote' }));
    const cmdParts = [...cliCommandParts, ...cliArgs];
    const cmd = cmdParts.map(shellEscape_1.quoteShellArg).join(' ');
    return { cli: cliCheckCommand, cmd, installCommand: provider?.installCommand };
}
/** Convert SSH args to SCP-compatible args (e.g. `-p` port → `-P` port). */
function buildScpArgs(sshArgs) {
    const scpArgs = [];
    for (let i = 0; i < sshArgs.length; i++) {
        if (sshArgs[i] === '-p' && i + 1 < sshArgs.length) {
            // scp uses -P (uppercase) for port
            scpArgs.push('-P', sshArgs[i + 1]);
            i++;
        }
        else if ((sshArgs[i] === '-i' || sshArgs[i] === '-o' || sshArgs[i] === '-F') &&
            i + 1 < sshArgs.length) {
            scpArgs.push(sshArgs[i], sshArgs[i + 1]);
            i++;
        }
    }
    return scpArgs;
}
function execFileAsync(cmd, args) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)(cmd, args, { timeout: 30000 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`${cmd} failed: ${stderr || error.message}`));
            }
            else {
                resolve({ stdout, stderr });
            }
        });
    });
}
async function resolveShellSetup(cwd) {
    // Committed .emdash.json lives in the worktree itself
    const fromCwd = LifecycleScriptsService_1.lifecycleScriptsService.getShellSetup(cwd);
    if (fromCwd)
        return fromCwd;
    // Uncommitted .emdash.json only exists in the project root — look it up via DB
    try {
        const task = await DatabaseService_1.databaseService.getTaskByPath(cwd);
        const project = task ? await DatabaseService_1.databaseService.getProjectById(task.projectId) : null;
        if (project?.path)
            return LifecycleScriptsService_1.lifecycleScriptsService.getShellSetup(project.path) ?? undefined;
    }
    catch { }
    return undefined;
}
async function resolveTmuxEnabled(cwd) {
    if (LifecycleScriptsService_1.lifecycleScriptsService.getTmuxEnabled(cwd))
        return true;
    try {
        const task = await DatabaseService_1.databaseService.getTaskByPath(cwd);
        const project = task ? await DatabaseService_1.databaseService.getProjectById(task.projectId) : null;
        if (project?.path)
            return LifecycleScriptsService_1.lifecycleScriptsService.getTmuxEnabled(project.path);
    }
    catch { }
    return false;
}
function registerPtyIpc() {
    // When a direct-spawned CLI exits, spawn a shell so user can continue working
    (0, ptyManager_1.setOnDirectCliExit)(async (id, cwd) => {
        const wc = owners.get(id);
        if (!wc)
            return;
        try {
            // Spawn a shell in the same terminal
            const proc = await (0, ptyManager_1.startPty)({
                id,
                cwd,
                cols: 120,
                rows: 32,
            });
            if (!proc) {
                logger_1.log.warn('ptyIpc: Failed to spawn shell after CLI exit', { id });
                (0, ptyManager_1.killPty)(id); // Clean up dead PTY record
                return;
            }
            // Re-attach listeners for the new shell process
            listeners.delete(id); // Clear old listener registration
            if (!listeners.has(id)) {
                proc.onData((data) => {
                    bufferedSendPtyData(id, data);
                });
                proc.onExit(({ exitCode, signal }) => {
                    flushPtyData(id);
                    clearPtyData(id);
                    safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
                    sendPtyExitGlobal(id);
                    owners.delete(id);
                    listeners.delete(id);
                    (0, ptyManager_1.removePtyRecord)(id);
                });
                listeners.add(id);
            }
            // Notify renderer that shell is ready (reuse pty:started so existing listener handles it)
            if (!wc.isDestroyed()) {
                wc.send('pty:started', { id });
            }
        }
        catch (err) {
            logger_1.log.error('ptyIpc: Error spawning shell after CLI exit', { id, error: err });
            (0, ptyManager_1.killPty)(id); // Clean up dead PTY record
        }
    });
    electron_1.ipcMain.handle('pty:start', async (event, args) => {
        const ptyStartTime = performance.now();
        if (process.env.EMDASH_DISABLE_PTY === '1') {
            return { ok: false, error: 'PTY disabled via EMDASH_DISABLE_PTY=1' };
        }
        try {
            const { id, cwd, remote, shell, env, cols, rows, autoApprove, initialPrompt, skipResume } = args;
            const existing = (0, ptyManager_1.getPty)(id);
            // Remote PTY routing: run an interactive ssh session in a local PTY.
            if (remote?.connectionId) {
                const wc = event.sender;
                owners.set(id, wc);
                if (existing) {
                    const kind = (0, ptyManager_1.getPtyKind)(id);
                    if (kind === 'ssh') {
                        return { ok: true, reused: true };
                    }
                    // Replace an existing local PTY with an SSH-backed PTY.
                    try {
                        (0, ptyManager_1.killPty)(id);
                    }
                    catch { }
                    listeners.delete(id);
                }
                const ssh = await resolveSshInvocation(remote.connectionId);
                const remoteInitCommand = cwd
                    ? `cd ${(0, shellEscape_1.quoteShellArg)(cwd)} && exec \${SHELL:-/bin/sh} -il`
                    : undefined;
                const proc = (0, ptyManager_1.startSshPty)({
                    id,
                    target: ssh.target,
                    sshArgs: ssh.args,
                    remoteInitCommand,
                    cols,
                    rows,
                    env,
                });
                if (!listeners.has(id)) {
                    proc.onData((data) => {
                        bufferedSendPtyData(id, data);
                    });
                    proc.onExit(({ exitCode, signal }) => {
                        cancelPromptHandles(id);
                        flushPtyData(id);
                        clearPtyData(id);
                        safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
                        sendPtyExitGlobal(id);
                        owners.delete(id);
                        listeners.delete(id);
                        (0, ptyManager_1.removePtyRecord)(id);
                    });
                    listeners.add(id);
                }
                const remoteTmux = cwd ? await resolveTmuxEnabled(cwd) : false;
                const remoteTmuxOpt = remoteTmux ? { sessionName: (0, ptyManager_1.getTmuxSessionName)(id) } : undefined;
                const remoteInit = buildRemoteInitKeystrokes({
                    cwd: undefined,
                    tmux: remoteTmuxOpt,
                });
                if (remoteInit) {
                    waitForSshPromptThenWrite(id, proc, remoteInit, 'ptyIpc:start');
                }
                try {
                    const windows = electron_1.BrowserWindow.getAllWindows();
                    windows.forEach((w) => w.webContents.send('pty:started', { id }));
                }
                catch { }
                return { ok: true, tmux: remoteTmux };
            }
            // Determine if we should skip resume
            let shouldSkipResume = skipResume;
            // Check if this is an additional (non-main) chat
            const isAdditionalChat = (0, ptyId_1.isChatPty)(id);
            if (isAdditionalChat) {
                // Additional chats can resume if the provider supports per-session
                // isolation (via sessionIdFlag), since each chat gets its own
                // session UUID. Without session isolation, always start fresh to
                // avoid all chats sharing the provider's directory-scoped state.
                const parsed = (0, ptyId_1.parsePtyId)(id);
                const chatProvider = parsed ? (0, registry_1.getProvider)(parsed.providerId) : null;
                if (!chatProvider?.sessionIdFlag) {
                    shouldSkipResume = true;
                }
                // Otherwise keep shouldSkipResume from the renderer (undefined or
                // explicitly set), which is based on whether a snapshot exists.
            }
            else if (shouldSkipResume === undefined) {
                // For main chats, check if this is a first-time start
                // For Claude and similar providers, check if a session directory exists
                if (cwd && shell) {
                    try {
                        const fs = require('fs');
                        const path = require('path');
                        const os = require('os');
                        const crypto = require('crypto');
                        // Check if this is Claude by looking at the shell
                        const isClaudeOrSimilar = shell.includes('claude') || shell.includes('aider');
                        if (isClaudeOrSimilar) {
                            // Claude stores sessions in ~/.claude/projects/ with various naming schemes
                            // Check both hash-based and path-based directory names
                            const cwdHash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16);
                            const claudeHashDir = path.join(os.homedir(), '.claude', 'projects', cwdHash);
                            // Also check for path-based directory name (Claude's actual format)
                            // Replace path separators with hyphens for the directory name
                            const pathBasedName = cwd.replace(/\//g, '-');
                            const claudePathDir = path.join(os.homedir(), '.claude', 'projects', pathBasedName);
                            // Check if any Claude session directory exists for this working directory
                            const projectsDir = path.join(os.homedir(), '.claude', 'projects');
                            let sessionExists = false;
                            // Check if the hash-based directory exists
                            sessionExists = fs.existsSync(claudeHashDir);
                            // If not, check for path-based directory
                            if (!sessionExists) {
                                sessionExists = fs.existsSync(claudePathDir);
                            }
                            // If still not found, scan the projects directory for any matching directory
                            if (!sessionExists && fs.existsSync(projectsDir)) {
                                try {
                                    const dirs = fs.readdirSync(projectsDir);
                                    // Check if any directory contains part of the working directory path
                                    const cwdParts = cwd.split('/').filter((p) => p.length > 0);
                                    const lastParts = cwdParts.slice(-3).join('-'); // Use last 3 parts of path
                                    sessionExists = dirs.some((dir) => dir.includes(lastParts));
                                }
                                catch {
                                    // Ignore scan errors
                                }
                            }
                            // Skip resume if no session directory exists (new task)
                            shouldSkipResume = !sessionExists;
                        }
                        else {
                            // For other providers, default to not skipping (allow resume if supported)
                            shouldSkipResume = false;
                        }
                    }
                    catch (e) {
                        // On error, default to not skipping
                        shouldSkipResume = false;
                    }
                }
                else {
                    // If no cwd or shell, default to not skipping
                    shouldSkipResume = false;
                }
            }
            else {
                // Use the explicitly provided value
                shouldSkipResume = shouldSkipResume || false;
            }
            const parsedPty = (0, ptyId_1.parsePtyId)(id);
            if (parsedPty)
                (0, ClaudeConfigService_1.maybeAutoTrustForClaude)(parsedPty.providerId, cwd);
            const shellSetup = cwd ? await resolveShellSetup(cwd) : undefined;
            const tmux = cwd ? await resolveTmuxEnabled(cwd) : false;
            const proc = existing ??
                (await (0, ptyManager_1.startPty)({
                    id,
                    cwd,
                    shell,
                    env,
                    cols,
                    rows,
                    autoApprove,
                    initialPrompt,
                    skipResume: shouldSkipResume,
                    shellSetup,
                    tmux,
                }));
            const wc = event.sender;
            owners.set(id, wc);
            // Attach data/exit listeners once per PTY id
            if (!listeners.has(id)) {
                proc.onData((data) => {
                    bufferedSendPtyData(id, data);
                });
                proc.onExit(({ exitCode, signal }) => {
                    flushPtyData(id);
                    clearPtyData(id);
                    // Check if this PTY is still active (not replaced by a newer instance)
                    if ((0, ptyManager_1.getPty)(id) !== proc) {
                        return;
                    }
                    safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
                    sendPtyExitGlobal(id);
                    maybeMarkProviderFinish(id, exitCode, signal, isAppQuitting ? 'app_quit' : 'process_exit');
                    owners.delete(id);
                    listeners.delete(id);
                    (0, ptyManager_1.removePtyRecord)(id);
                });
                listeners.add(id);
            }
            // Clean up all PTYs owned by this WebContents when it's destroyed
            // Only register once per WebContents to avoid MaxListenersExceededWarning
            if (!wcDestroyedListeners.has(wc.id)) {
                wcDestroyedListeners.add(wc.id);
                wc.once('destroyed', () => {
                    wcDestroyedListeners.delete(wc.id);
                    // Clean up all PTYs owned by this WebContents
                    for (const [ptyId, owner] of owners.entries()) {
                        if (owner === wc) {
                            try {
                                maybeMarkProviderFinish(ptyId, null, undefined, isAppQuitting ? 'app_quit' : 'owner_destroyed');
                                (0, ptyManager_1.killPty)(ptyId);
                            }
                            catch { }
                            owners.delete(ptyId);
                            listeners.delete(ptyId);
                        }
                    }
                });
            }
            // Track agent start even when reusing PTY (happens after shell respawn)
            // This ensures subsequent agent runs in the same task are tracked
            maybeMarkProviderStart(id);
            // Signal that PTY is ready
            try {
                const windows = electron_1.BrowserWindow.getAllWindows();
                windows.forEach((w) => {
                    try {
                        if (!w.webContents.isDestroyed()) {
                            w.webContents.send('pty:started', { id });
                        }
                    }
                    catch { }
                });
            }
            catch { }
            return { ok: true, tmux };
        }
        catch (err) {
            logger_1.log.error('pty:start FAIL', {
                id: args.id,
                cwd: args.cwd,
                shell: args.shell,
                error: err?.message || err,
            });
            // Track PTY start errors
            const parsed = parseProviderPty(args.id);
            await errorTracking_1.errorTracking.captureAgentSpawnError(err, parsed?.providerId || args.shell || 'unknown', parsed?.taskId || args.id, {
                cwd: args.cwd,
                autoApprove: args.autoApprove,
                hasInitialPrompt: !!args.initialPrompt,
            });
            return { ok: false, error: String(err?.message || err) };
        }
    });
    electron_1.ipcMain.on('pty:input', (_event, args) => {
        try {
            (0, ptyManager_1.writePty)(args.id, args.data);
            // Track prompts sent to agents (not shell terminals)
            // Only count Enter key presses for known agent PTYs
            if (args.data === '\r' || args.data === '\n') {
                // Check if this PTY is associated with an agent
                const providerId = ptyProviderMap.get(args.id) || parseProviderPty(args.id)?.providerId;
                if (providerId) {
                    // This is an agent terminal, track the prompt
                    telemetry.capture('agent_prompt_sent', {
                        provider: providerId,
                    });
                }
            }
        }
        catch (e) {
            logger_1.log.error('pty:input error', { id: args.id, error: e });
        }
    });
    electron_1.ipcMain.on('pty:resize', (_event, args) => {
        try {
            (0, ptyManager_1.resizePty)(args.id, args.cols, args.rows);
        }
        catch (e) {
            logger_1.log.error('pty:resize error', { id: args.id, cols: args.cols, rows: args.rows, error: e });
        }
    });
    electron_1.ipcMain.on('pty:kill', (_event, args) => {
        try {
            cleanupPtySession(args.id);
        }
        catch (e) {
            logger_1.log.error('pty:kill error', { id: args.id, error: e });
        }
    });
    electron_1.ipcMain.handle('pty:cleanupSessions', async (_event, args) => {
        const ids = Array.from(new Set((args?.ids || []).filter(Boolean)));
        const failedIds = [];
        for (const id of ids) {
            try {
                cleanupPtySession(id);
            }
            catch (error) {
                failedIds.push(id);
                logger_1.log.error('pty:cleanupSessions kill error', { id, error });
            }
        }
        const clearSnapshots = args?.clearSnapshots === true;
        const waitForSnapshots = args?.waitForSnapshots === true;
        if (clearSnapshots) {
            const clearPromise = Promise.allSettled(ids.map(async (id) => {
                try {
                    await TerminalSnapshotService_1.terminalSnapshotService.deleteSnapshot(id);
                }
                catch { }
            }));
            if (waitForSnapshots) {
                await clearPromise;
            }
            else {
                void clearPromise;
            }
        }
        return {
            ok: failedIds.length === 0,
            cleaned: ids.length - failedIds.length,
            failedIds,
            snapshotClearQueued: clearSnapshots,
        };
    });
    // Kill a tmux session by PTY ID (used during task deletion cleanup)
    electron_1.ipcMain.handle('pty:killTmux', async (_event, args) => {
        try {
            (0, ptyManager_1.killTmuxSession)(args.id);
            return { ok: true };
        }
        catch (e) {
            logger_1.log.error('pty:killTmux error', { id: args.id, error: e });
            return { ok: false, error: String(e) };
        }
    });
    electron_1.ipcMain.handle('pty:snapshot:get', async (_event, args) => {
        try {
            const snapshot = await TerminalSnapshotService_1.terminalSnapshotService.getSnapshot(args.id);
            return { ok: true, snapshot };
        }
        catch (error) {
            logger_1.log.error('pty:snapshot:get failed', { id: args.id, error });
            return { ok: false, error: error?.message || String(error) };
        }
    });
    electron_1.ipcMain.handle('pty:snapshot:save', async (_event, args) => {
        const { id, payload } = args;
        const result = await TerminalSnapshotService_1.terminalSnapshotService.saveSnapshot(id, payload);
        if (!result.ok) {
            logger_1.log.warn('pty:snapshot:save failed', { id, error: result.error });
        }
        return result;
    });
    electron_1.ipcMain.handle('pty:snapshot:clear', async (_event, args) => {
        await TerminalSnapshotService_1.terminalSnapshotService.deleteSnapshot(args.id);
        return { ok: true };
    });
    electron_1.ipcMain.handle('terminal:getTheme', async () => {
        try {
            const config = (0, TerminalConfigParser_1.detectAndLoadTerminalConfig)();
            if (config) {
                return { ok: true, config };
            }
            return { ok: false, error: 'No terminal configuration found' };
        }
        catch (error) {
            logger_1.log.error('terminal:getTheme failed', { error });
            return { ok: false, error: error?.message || String(error) };
        }
    });
    // SCP file transfer to SSH remote (for file drop on SSH terminals)
    electron_1.ipcMain.handle('pty:scp-to-remote', async (_event, args) => {
        try {
            const ssh = await resolveSshInvocation(args.connectionId);
            const scpArgs = buildScpArgs(ssh.args);
            const remoteDir = '/tmp/emdash-images';
            // Ensure remote directory exists
            await execFileAsync('ssh', [...ssh.args, ssh.target, `mkdir -p ${remoteDir}`]);
            // Transfer each file individually so UUID-prefixed names avoid collisions
            // (batching into one scp call would lose uniqueness for same-named files)
            const remotePaths = [];
            for (const localPath of args.localPaths) {
                const remoteName = `${(0, crypto_1.randomUUID)()}-${path_1.default.basename(localPath)}`;
                const remotePath = `${remoteDir}/${remoteName}`;
                await execFileAsync('scp', [...scpArgs, localPath, `${ssh.target}:${remotePath}`]);
                remotePaths.push(remotePath);
            }
            return { success: true, remotePaths };
        }
        catch (err) {
            logger_1.log.error('pty:scp-to-remote failed', {
                connectionId: args.connectionId,
                error: err?.message || err,
            });
            return { success: false, error: String(err?.message || err) };
        }
    });
    // Start a PTY by spawning CLI directly (no shell wrapper)
    // This is faster but falls back to shell-based spawn if CLI path unknown
    electron_1.ipcMain.handle('pty:startDirect', async (event, args) => {
        if (process.env.EMDASH_DISABLE_PTY === '1') {
            return { ok: false, error: 'PTY disabled via EMDASH_DISABLE_PTY=1' };
        }
        try {
            const { id, providerId, cwd, remote, cols, rows, autoApprove, initialPrompt, env, resume, ownerTaskId, } = args;
            const existing = (0, ptyManager_1.getPty)(id);
            if (remote?.connectionId) {
                const wc = event.sender;
                owners.set(id, wc);
                if (existing) {
                    const kind = (0, ptyManager_1.getPtyKind)(id);
                    if (kind === 'ssh') {
                        return { ok: true, reused: true };
                    }
                    try {
                        (0, ptyManager_1.killPty)(id);
                    }
                    catch { }
                    listeners.delete(id);
                }
                // Resolve SSH invocation and tmux setting in parallel
                const [ssh, remoteTmux] = await Promise.all([
                    resolveSshInvocation(remote.connectionId),
                    cwd ? resolveTmuxEnabled(cwd) : Promise.resolve(false),
                ]);
                const remoteProvider = buildRemoteProviderInvocation({
                    providerId,
                    autoApprove,
                    initialPrompt,
                    resume,
                    id,
                    cwd,
                    ownerTaskId,
                });
                const resolvedConfig = (0, ptyManager_1.resolveProviderCommandConfig)(providerId);
                const mergedEnv = resolvedConfig?.env ? { ...resolvedConfig.env, ...env } : env;
                const preProviderCommands = [];
                // Fire off remote config writes in parallel with PTY startup.
                // These SSH exec calls are independent of the PTY connection and
                // only need to complete before the agent reads the config — which
                // happens well after the shell prompt is ready.
                const backgroundSetupPromises = [];
                if (providerId === 'opencode') {
                    backgroundSetupPromises.push(writeRemoteOpenCodePlugin(ssh.args, ssh.target, id)
                        .then((remoteConfigDir) => {
                        preProviderCommands.push(`export OPENCODE_CONFIG_DIR="${remoteConfigDir}"`);
                    })
                        .catch((err) => {
                        logger_1.log.warn('ptyIpc:startDirect failed to write remote OpenCode plugin', {
                            id,
                            error: err?.message || String(err),
                        });
                    }));
                }
                // Set up reverse SSH tunnel for hook events if the local hook
                // server is running. This lets the remote agent call back to
                // the local AgentEventService via the tunnel.
                const hookPort = AgentEventService_1.agentEventService.getPort();
                if (hookPort > 0) {
                    const remotePort = pickReverseTunnelPort(id);
                    // For Claude, write hook config on the remote via ssh exec.
                    // Runs in background — the config only needs to exist before
                    // the agent reads it, which happens after shell prompt + agent
                    // startup (several seconds later).
                    if (providerId === 'claude' && cwd) {
                        backgroundSetupPromises.push(writeRemoteHookConfig([...ssh.args], ssh.target, cwd).catch((err) => {
                            logger_1.log.warn('ptyIpc:startDirect failed to write remote hook config', {
                                id,
                                error: err?.message || String(err),
                            });
                        }));
                    }
                    ssh.args.push('-R', `127.0.0.1:${remotePort}:127.0.0.1:${hookPort}`);
                    preProviderCommands.push(`export EMDASH_HOOK_PORT=${(0, shellEscape_1.quoteShellArg)(String(remotePort))}`, `export EMDASH_HOOK_TOKEN=${(0, shellEscape_1.quoteShellArg)(AgentEventService_1.agentEventService.getToken())}`, `export EMDASH_PTY_ID=${(0, shellEscape_1.quoteShellArg)(id)}`);
                }
                // Wait for any setup that provides env vars needed by the init
                // keystrokes (e.g. OPENCODE_CONFIG_DIR).  Hook config can finish
                // later — it's okay if it lands after PTY spawn.
                if (backgroundSetupPromises.length > 0) {
                    await Promise.all(backgroundSetupPromises);
                }
                const remoteInitCommand = cwd
                    ? `cd ${(0, shellEscape_1.quoteShellArg)(cwd)} && exec \${SHELL:-/bin/sh} -il`
                    : undefined;
                const proc = (0, ptyManager_1.startSshPty)({
                    id,
                    target: ssh.target,
                    sshArgs: ssh.args,
                    remoteInitCommand,
                    cols,
                    rows,
                    env: mergedEnv,
                });
                if (!listeners.has(id)) {
                    proc.onData((data) => {
                        bufferedSendPtyData(id, data);
                    });
                    proc.onExit(({ exitCode, signal }) => {
                        cancelPromptHandles(id);
                        flushPtyData(id);
                        clearPtyData(id);
                        safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
                        sendPtyExitGlobal(id);
                        maybeMarkProviderFinish(id, exitCode, signal, 'process_exit');
                        owners.delete(id);
                        listeners.delete(id);
                        (0, ptyManager_1.removePtyRecord)(id);
                    });
                    listeners.add(id);
                }
                const tmuxOpt = remoteTmux ? { sessionName: (0, ptyManager_1.getTmuxSessionName)(id) } : undefined;
                const remoteInit = buildRemoteInitKeystrokes({
                    cwd: undefined,
                    provider: remoteProvider,
                    tmux: tmuxOpt,
                    preProviderCommands: preProviderCommands.length ? preProviderCommands : undefined,
                });
                if (remoteInit) {
                    waitForSshPromptThenWrite(id, proc, remoteInit, 'ptyIpc:startDirect');
                }
                maybeMarkProviderStart(id);
                try {
                    const windows = electron_1.BrowserWindow.getAllWindows();
                    windows.forEach((w) => w.webContents.send('pty:started', { id }));
                }
                catch { }
                return { ok: true, tmux: remoteTmux };
            }
            if (existing) {
                const wc = event.sender;
                owners.set(id, wc);
                // Still track agent start even when reusing PTY (happens after shell respawn)
                maybeMarkProviderStart(id, providerId);
                return { ok: true, reused: true };
            }
            // For additional chats without per-session isolation, never resume —
            // they'd share the provider's directory-scoped session with other chats.
            let effectiveResume = resume;
            if ((0, ptyId_1.isChatPty)(id)) {
                const chatProvider = (0, registry_1.getProvider)(providerId);
                if (!chatProvider?.sessionIdFlag) {
                    effectiveResume = false;
                }
            }
            if (providerId === 'codex') {
                await pruneInvalidCodexResumeTarget(id, cwd, effectiveResume);
            }
            (0, ClaudeConfigService_1.maybeAutoTrustForClaude)(providerId, cwd);
            const shellSetup = await resolveShellSetup(cwd);
            const tmux = await resolveTmuxEnabled(cwd);
            const codexBindingStartedAt = providerId === 'codex' ? Date.now() : 0;
            // Write Claude Code hook config so it calls back to Emdash on events
            if (providerId === 'claude') {
                try {
                    ClaudeHookService_1.ClaudeHookService.writeHookConfig(cwd);
                }
                catch (err) {
                    logger_1.log.warn('pty:startDirect - failed to write Claude hook config', {
                        error: String(err),
                    });
                }
            }
            // Try direct spawn first; skip if shellSetup or tmux requires a shell wrapper
            const directProc = shellSetup || tmux
                ? null
                : (0, ptyManager_1.startDirectPty)({
                    id,
                    providerId,
                    cwd,
                    cols,
                    rows,
                    autoApprove,
                    initialPrompt,
                    env,
                    resume: effectiveResume,
                    tmux,
                    ownerTaskId,
                });
            // Fall back to shell-based spawn when direct spawn is unavailable or shellSetup/tmux is set
            let usedFallback = false;
            let proc;
            if (directProc) {
                proc = directProc;
            }
            else {
                const provider = (0, registry_1.getProvider)(providerId);
                if (!provider?.cli) {
                    return { ok: false, error: `CLI path not found for provider: ${providerId}` };
                }
                if (!shellSetup && !tmux)
                    logger_1.log.info('pty:startDirect - falling back to shell spawn', { id, providerId });
                proc = await (0, ptyManager_1.startPty)({
                    id,
                    cwd,
                    shell: provider.cli,
                    cols,
                    rows,
                    autoApprove,
                    initialPrompt,
                    env,
                    skipResume: !resume,
                    shellSetup,
                    tmux,
                    ownerTaskId,
                });
                usedFallback = true;
            }
            const wc = event.sender;
            owners.set(id, wc);
            if (!listeners.has(id)) {
                proc.onData((data) => {
                    bufferedSendPtyData(id, data);
                });
                proc.onExit(({ exitCode, signal }) => {
                    flushPtyData(id);
                    clearPtyData(id);
                    maybeMarkProviderFinish(id, exitCode, signal, isAppQuitting ? 'app_quit' : 'process_exit');
                    // Direct-spawn CLIs can be replaced immediately by a fallback shell after exit.
                    // If this PTY has already been replaced, skip cleanup so we don't delete the new PTY record.
                    const current = (0, ptyManager_1.getPty)(id);
                    if (current && current !== proc) {
                        return;
                    }
                    safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
                    sendPtyExitGlobal(id);
                    // For direct spawn: keep owner (shell respawn reuses it), delete listeners (shell respawn re-adds)
                    // For fallback: clean up owner since no shell respawn happens
                    if (usedFallback) {
                        owners.delete(id);
                    }
                    listeners.delete(id);
                    (0, ptyManager_1.removePtyRecord)(id);
                });
                listeners.add(id);
            }
            // Clean up all PTYs owned by this WebContents when it's destroyed
            // Only register once per WebContents to avoid MaxListenersExceededWarning
            if (!wcDestroyedListeners.has(wc.id)) {
                wcDestroyedListeners.add(wc.id);
                wc.once('destroyed', () => {
                    wcDestroyedListeners.delete(wc.id);
                    for (const [ptyId, owner] of owners.entries()) {
                        if (owner === wc) {
                            try {
                                maybeMarkProviderFinish(ptyId, null, undefined, isAppQuitting ? 'app_quit' : 'owner_destroyed');
                                (0, ptyManager_1.killPty)(ptyId);
                            }
                            catch { }
                            owners.delete(ptyId);
                            listeners.delete(ptyId);
                        }
                    }
                });
            }
            maybeMarkProviderStart(id, providerId);
            if (providerId === 'codex') {
                scheduleCodexThreadBinding(id, cwd, codexBindingStartedAt);
            }
            try {
                const windows = electron_1.BrowserWindow.getAllWindows();
                windows.forEach((w) => w.webContents.send('pty:started', { id }));
            }
            catch { }
            return { ok: true, tmux };
        }
        catch (err) {
            logger_1.log.error('pty:startDirect FAIL', { id: args.id, error: err?.message || err });
            return { ok: false, error: String(err?.message || err) };
        }
    });
}
function parseProviderPty(id) {
    const parsed = (0, ptyId_1.parsePtyId)(id);
    if (!parsed)
        return null;
    return { providerId: parsed.providerId, taskId: parsed.suffix };
}
function providerRunKey(providerId, taskId) {
    return `${providerId}:${taskId}`;
}
function maybeMarkProviderStart(id, providerId) {
    finalizedPtys.delete(id);
    // First check if we have a direct provider ID (for multi-agent mode)
    if (providerId && registry_1.PROVIDER_IDS.includes(providerId)) {
        ptyProviderMap.set(id, providerId);
        const key = `${providerId}:${id}`;
        if (providerPtyTimers.has(key))
            return;
        providerPtyTimers.set(key, Date.now());
        telemetry.capture('agent_run_start', { provider: providerId });
        return;
    }
    // Check if we have a stored mapping (for subsequent calls)
    const storedProvider = ptyProviderMap.get(id);
    if (storedProvider) {
        const key = `${storedProvider}:${id}`;
        if (providerPtyTimers.has(key))
            return;
        providerPtyTimers.set(key, Date.now());
        telemetry.capture('agent_run_start', { provider: storedProvider });
        return;
    }
    // Fall back to parsing the ID (single-agent mode)
    const parsed = parseProviderPty(id);
    if (!parsed)
        return;
    const key = providerRunKey(parsed.providerId, parsed.taskId);
    if (providerPtyTimers.has(key))
        return;
    providerPtyTimers.set(key, Date.now());
    telemetry.capture('agent_run_start', { provider: parsed.providerId });
}
function maybeMarkProviderFinish(id, exitCode, signal, cause) {
    if (finalizedPtys.has(id))
        return;
    finalizedPtys.add(id);
    let providerId;
    let key;
    // First check if we have a stored mapping (multi-agent mode)
    const storedProvider = ptyProviderMap.get(id);
    if (storedProvider) {
        providerId = storedProvider;
        key = `${storedProvider}:${id}`;
    }
    else {
        // Fall back to parsing the ID (single-agent mode)
        const parsed = parseProviderPty(id);
        if (!parsed)
            return;
        providerId = parsed.providerId;
        key = providerRunKey(parsed.providerId, parsed.taskId);
    }
    const started = providerPtyTimers.get(key);
    providerPtyTimers.delete(key);
    // Clean up the provider mapping
    ptyProviderMap.delete(id);
    // No valid exit code means the process was killed during cleanup, not a real completion
    if (typeof exitCode !== 'number')
        return;
    const duration = started ? Math.max(0, Date.now() - started) : undefined;
    const wasSignaled = signal !== undefined && signal !== null;
    const outcome = exitCode !== 0 && !wasSignaled ? 'error' : 'ok';
    telemetry.capture('agent_run_finish', {
        provider: providerId,
        outcome,
        duration_ms: duration,
    });
}
// Kill all PTYs on app shutdown to prevent crash loop
try {
    electron_1.app.on('before-quit', () => {
        isAppQuitting = true;
        for (const id of Array.from(owners.keys())) {
            try {
                // Ensure telemetry timers are cleared on app quit
                maybeMarkProviderFinish(id, null, undefined, 'app_quit');
                (0, ptyManager_1.killPty)(id);
            }
            catch { }
        }
        owners.clear();
        listeners.clear();
    });
}
catch { }
