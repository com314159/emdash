"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectionsService = exports.CLI_DEFINITIONS = void 0;
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const providerStatusCache_1 = require("./providerStatusCache");
const registry_1 = require("@shared/providers/registry");
const logger_1 = require("../lib/logger");
const truncate = (input, max = 400) => input && input.length > max ? `${input.slice(0, max)}…` : input;
const DEFAULT_TIMEOUT_MS = 3000;
const quoteForCmdExe = (input) => {
    if (input.length === 0)
        return '""';
    if (!/[\s"^&|<>()%!]/.test(input))
        return input;
    return `"${input
        .replace(/%/g, '%%')
        .replace(/!/g, '^!')
        .replace(/(["^&|<>()])/g, '^$1')}"`;
};
exports.CLI_DEFINITIONS = (0, registry_1.listDetectableProviders)().map((provider) => ({
    id: provider.id,
    name: provider.name,
    commands: provider.commands ?? [],
    args: provider.versionArgs ?? ['--version'],
    docUrl: provider.docUrl,
    installCommand: provider.installCommand,
    detectable: provider.detectable,
}));
class ConnectionsService {
    constructor() {
        this.initialized = false;
        this.timeoutRetryPending = new Set();
        this.timeoutRetryTimers = new Map();
    }
    clearTimeoutRetry(providerId) {
        const pendingTimer = this.timeoutRetryTimers.get(providerId);
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            this.timeoutRetryTimers.delete(providerId);
        }
        this.timeoutRetryPending.delete(providerId);
    }
    async initProviderStatusCache() {
        if (this.initialized)
            return;
        this.initialized = true;
        await providerStatusCache_1.providerStatusCache.load();
        // Check all providers and log a summary
        await Promise.all(exports.CLI_DEFINITIONS.map((def) => this.checkProvider(def.id, 'bootstrap')));
        const statuses = providerStatusCache_1.providerStatusCache.getAll();
        const connected = exports.CLI_DEFINITIONS.filter((d) => statuses[d.id]?.installed).map((d) => d.id);
        const notInstalled = exports.CLI_DEFINITIONS.filter((d) => !statuses[d.id]?.installed).map((d) => d.id);
        logger_1.log.info(`Providers: connected (${connected.join(', ') || 'none'}) | not installed (${notInstalled.join(', ') || 'none'})`);
    }
    getCachedProviderStatuses() {
        return providerStatusCache_1.providerStatusCache.getAll();
    }
    async checkProvider(providerId, reason = 'manual', opts) {
        const def = exports.CLI_DEFINITIONS.find((d) => d.id === providerId);
        if (!def)
            return;
        if (reason !== 'timeout-retry' && this.timeoutRetryPending.has(providerId)) {
            // Cancel any pending timeout-based retry when a fresh check is requested.
            this.clearTimeoutRetry(providerId);
        }
        const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const commandResult = await this.tryCommands(def, timeoutMs);
        const statusCode = await this.resolveStatus(def, commandResult);
        this.cacheStatus(def.id, commandResult, statusCode);
        // Only log verbose details for actual errors (not just "not installed")
        const isActualError = (statusCode === 'error' || statusCode === 'needs_key') && commandResult.resolvedPath !== null; // binary was found but something went wrong
        if (isActualError) {
            logger_1.log.warn('provider:error', {
                providerId: def.id,
                status: statusCode,
                command: commandResult.command,
                resolvedPath: commandResult.resolvedPath,
                exitStatus: commandResult.status,
                stderr: commandResult.stderr ? truncate(commandResult.stderr) : null,
                stdout: commandResult.stdout ? truncate(commandResult.stdout) : null,
                error: commandResult.error
                    ? String(commandResult.error?.message || commandResult.error)
                    : null,
            });
        }
        const shouldRetryTimeout = commandResult.timedOut &&
            (commandResult.resolvedPath || commandResult.stdout) &&
            opts?.allowRetry !== false;
        if (shouldRetryTimeout && !this.timeoutRetryPending.has(providerId)) {
            this.timeoutRetryPending.add(providerId);
            const retryDelayMs = 1500;
            const retryTimeoutMs = Math.max(timeoutMs * 2, 12000);
            const retryTimer = setTimeout(() => {
                this.timeoutRetryTimers.delete(providerId);
                void this.checkProvider(providerId, 'timeout-retry', {
                    timeoutMs: retryTimeoutMs,
                    allowRetry: false,
                }).finally(() => this.timeoutRetryPending.delete(providerId));
            }, retryDelayMs);
            this.timeoutRetryTimers.set(providerId, retryTimer);
        }
    }
    async refreshAllProviderStatuses() {
        logger_1.log.info('provider:refreshAll:start');
        await Promise.all(exports.CLI_DEFINITIONS.map((definition) => this.checkProvider(definition.id, 'manual')));
        logger_1.log.info('provider:refreshAll:done');
        return this.getCachedProviderStatuses();
    }
    async resolveStatus(def, result) {
        if (def.statusResolver) {
            return def.statusResolver(result);
        }
        if (result.success) {
            return 'connected';
        }
        if (result.resolvedPath) {
            return 'connected';
        }
        if (result.timedOut && result.stdout) {
            return 'connected';
        }
        if (result.status !== null && !result.timedOut && (result.stdout || result.stderr)) {
            return 'connected';
        }
        return result.error ? 'error' : 'missing';
    }
    resolveMessage(def, result, status) {
        if (def.id === 'codex') {
            return status === 'connected'
                ? null
                : 'Codex CLI not detected. Install @openai/codex to enable Codex agents.';
        }
        if (def.messageResolver) {
            return def.messageResolver(result);
        }
        if (status === 'missing') {
            return `${def.name} was not found in PATH.`;
        }
        if (status === 'error') {
            if (result.stderr.trim()) {
                return result.stderr.trim();
            }
            if (result.stdout.trim()) {
                return result.stdout.trim();
            }
            if (result.error) {
                return result.error.message;
            }
        }
        return null;
    }
    async tryCommands(def, timeoutMs) {
        for (const command of def.commands) {
            const result = await this.runCommand(command, def.args ?? ['--version'], timeoutMs);
            if (result.success) {
                return result;
            }
            // If the command exists but returned a non-zero status, still return result for diagnostics
            if (result.error && result.error.code !== 'ENOENT') {
                return result;
            }
        }
        const lastCommand = def.commands[def.commands.length - 1];
        return this.runCommandViaShell(lastCommand, def.args ?? ['--version'], timeoutMs);
    }
    /** Run a command through the user's login shell as a fallback for detection. */
    async runCommandViaShell(command, args, timeoutMs) {
        const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh');
        const fullCmd = [command, ...args].join(' ');
        const shellArgs = process.platform === 'win32' ? ['/c', fullCmd] : ['-lc', fullCmd];
        const result = await this.runCommand(shell, shellArgs, timeoutMs);
        if (result.status === 127) {
            return {
                ...result,
                command,
                success: false,
                resolvedPath: null,
                status: null,
                error: new Error(`${command}: command not found (shell fallback)`),
            };
        }
        // Never cache the shell binary path as the provider path.
        // If provider resolution still fails here, keep `resolvedPath` null so
        // PTY startup falls back to shell-based spawn instead of direct-spawning the shell.
        const providerResolvedPath = this.resolveCommandPath(command);
        return { ...result, command, resolvedPath: providerResolvedPath };
    }
    async runCommand(command, args, timeoutMs) {
        const resolvedPath = this.resolveCommandPath(command);
        return new Promise((resolve) => {
            try {
                const executable = resolvedPath || command;
                const lowerExecutable = executable.toLowerCase();
                const shouldUseCmdExe = process.platform === 'win32' &&
                    (lowerExecutable.endsWith('.cmd') || lowerExecutable.endsWith('.bat'));
                const child = shouldUseCmdExe
                    ? (0, child_process_1.spawn)(process.env.ComSpec || 'cmd.exe', [
                        '/d',
                        '/s',
                        '/c',
                        [executable, ...args].map(quoteForCmdExe).join(' '),
                    ])
                    : (0, child_process_1.spawn)(command, args);
                let stdout = '';
                let stderr = '';
                let didTimeout = false;
                // timeout for version checks (some CLIs can start slowly)
                const timeoutId = setTimeout(() => {
                    didTimeout = true;
                    child.kill();
                }, timeoutMs);
                child.stdout?.on('data', (data) => {
                    stdout += data.toString();
                });
                child.stderr?.on('data', (data) => {
                    stderr += data.toString();
                });
                child.on('error', (error) => {
                    clearTimeout(timeoutId);
                    logger_1.log.warn('provider:command-spawn-error', {
                        command,
                        executable,
                        resolvedPath,
                        error: error?.message || String(error),
                    });
                    resolve({
                        command,
                        success: false,
                        error,
                        stdout: stdout || '',
                        stderr: stderr || '',
                        status: null,
                        version: null,
                        resolvedPath,
                        timedOut: didTimeout,
                        timeoutMs,
                    });
                });
                child.on('close', (code) => {
                    clearTimeout(timeoutId);
                    const success = !didTimeout && code === 0;
                    const version = this.extractVersion(stdout) || this.extractVersion(stderr);
                    if (!success) {
                        logger_1.log.warn('provider:command-exit-failed', {
                            command,
                            executable,
                            resolvedPath,
                            status: code,
                            timedOut: didTimeout,
                            stderr: stderr ? truncate(stderr) : null,
                            stdout: stdout ? truncate(stdout) : null,
                        });
                    }
                    resolve({
                        command,
                        success,
                        error: didTimeout ? new Error('Command timeout') : undefined,
                        stdout,
                        stderr,
                        status: code,
                        version,
                        resolvedPath,
                        timedOut: didTimeout,
                        timeoutMs,
                    });
                });
            }
            catch (error) {
                resolve({
                    command,
                    success: false,
                    error: error,
                    stdout: '',
                    stderr: '',
                    status: null,
                    version: null,
                    resolvedPath,
                    timedOut: false,
                    timeoutMs,
                });
            }
        });
    }
    extractVersion(output) {
        if (!output)
            return null;
        const matches = output.match(/\d+\.\d+(\.\d+)?/);
        return matches ? matches[0] : null;
    }
    resolveCommandPath(command) {
        const resolver = process.platform === 'win32' ? 'where' : 'which';
        try {
            const result = (0, child_process_1.execFileSync)(resolver, [command], { encoding: 'utf8' });
            const lines = result
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean);
            return lines[0] ?? null;
        }
        catch {
            return null;
        }
    }
    cacheStatus(providerId, result, statusCode) {
        const installed = statusCode === 'connected';
        const status = {
            installed,
            path: result.resolvedPath,
            version: result.version,
            lastChecked: Date.now(),
        };
        providerStatusCache_1.providerStatusCache.set(providerId, status);
        this.emitStatusUpdate(providerId, status);
    }
    emitStatusUpdate(providerId, status) {
        const payload = { providerId, status };
        electron_1.BrowserWindow.getAllWindows().forEach((win) => {
            try {
                win.webContents.send('provider:status-updated', payload);
            }
            catch {
                // ignore send errors
            }
        });
    }
}
exports.connectionsService = new ConnectionsService();
