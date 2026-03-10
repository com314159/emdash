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
exports.registerSshIpc = registerSshIpc;
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const types_1 = require("../../shared/ssh/types");
const SshService_1 = require("../services/ssh/SshService");
const SshCredentialService_1 = require("../services/ssh/SshCredentialService");
const SshHostKeyService_1 = require("../services/ssh/SshHostKeyService");
const SshConnectionMonitor_1 = require("../services/ssh/SshConnectionMonitor");
const drizzleClient_1 = require("../db/drizzleClient");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const crypto_1 = require("crypto");
const shellEscape_1 = require("../utils/shellEscape");
const sshCommandValidation_1 = require("../utils/sshCommandValidation");
const sshConfigParser_1 = require("../utils/sshConfigParser");
// Initialize services
const credentialService = new SshCredentialService_1.SshCredentialService();
// Host key service initialized for future use (host key verification)
const _hostKeyService = new SshHostKeyService_1.SshHostKeyService();
const monitor = new SshConnectionMonitor_1.SshConnectionMonitor((id) => SshService_1.sshService.isConnected(id));
// When ssh2 detects a dead connection (via keepalive) and emits `close`,
// SshService removes it from the pool and emits `disconnected`.
// The monitor reacts by triggering reconnect with exponential backoff.
SshService_1.sshService.on('disconnected', (connectionId) => {
    monitor.handleDisconnect(connectionId);
});
/**
 * Maps a database row to SshConfig
 */
function mapRowToConfig(row) {
    return {
        id: row.id,
        name: row.name,
        host: row.host,
        port: row.port,
        username: row.username,
        authType: row.authType,
        privateKeyPath: row.privateKeyPath ?? undefined,
        useAgent: row.useAgent === 1,
    };
}
/**
 * Validates that a remote path is safe to access.
 *
 * Uses a two-layer approach:
 *   1. Reject any path containing traversal sequences (even after normalization).
 *   2. Reject paths that resolve into known-sensitive directories.
 *
 * The path is resolved against '/' so that relative tricks like
 * "foo/../../etc/shadow" are caught.
 */
function isPathSafe(remotePath) {
    // Must be an absolute path
    if (!remotePath.startsWith('/')) {
        return false;
    }
    // Normalize repeated slashes
    const normalized = remotePath.replace(/\/+/g, '/');
    // Reject any occurrence of '..' as a path component
    // This catches ../  /..  and trailing /..
    const segments = normalized.split('/');
    if (segments.some((s) => s === '..')) {
        return false;
    }
    // Block access to sensitive system directories and hidden dotfiles
    const restrictedPrefixes = ['/etc/', '/proc/', '/sys/', '/dev/', '/boot/', '/root/'];
    for (const prefix of restrictedPrefixes) {
        if (normalized.startsWith(prefix) || normalized === prefix.slice(0, -1)) {
            return false;
        }
    }
    // Block .ssh directories anywhere in the path
    if (segments.some((s) => s === '.ssh')) {
        return false;
    }
    return true;
}
/**
 * Classify an SSH error into a safe, non-PII category for telemetry.
 */
function classifySshError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    if (msg.includes('authentication') || msg.includes('auth') || msg.includes('password')) {
        return 'auth_failed';
    }
    if (msg.includes('timed out') || msg.includes('timeout')) {
        return 'timeout';
    }
    if (msg.includes('econnrefused') ||
        msg.includes('enotfound') ||
        msg.includes('enetunreach') ||
        msg.includes('network')) {
        return 'network';
    }
    if (msg.includes('key') || msg.includes('passphrase') || msg.includes('decrypt')) {
        return 'key_error';
    }
    return 'unknown';
}
/**
 * Register all SSH IPC handlers
 */
function registerSshIpc() {
    // Wire up reconnect handler so the monitor's reconnect event actually reconnects (HIGH #9)
    monitor.on('reconnect', async (connectionId, config, attempt) => {
        try {
            console.log(`[sshIpc] Reconnecting ${connectionId} (attempt ${attempt})...`);
            // Clean up the stale/dead connection before opening a new one
            if (SshService_1.sshService.isConnected(connectionId)) {
                await SshService_1.sshService.disconnect(connectionId).catch(() => { });
            }
            await SshService_1.sshService.connect(config);
            monitor.updateState(connectionId, 'connected');
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('ssh_reconnect_attempted', { success: true });
            });
        }
        catch (err) {
            console.error(`[sshIpc] Reconnect attempt ${attempt} failed for ${connectionId}:`, err.message);
            monitor.updateState(connectionId, 'error', err.message);
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('ssh_reconnect_attempted', { success: false });
            });
        }
    });
    // Test connection
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.TEST_CONNECTION, async (_, config) => {
        try {
            // GSSAPI connections use system ssh for testing (ssh2 doesn't support GSSAPI)
            if (config.authType === 'gssapi') {
                return new Promise((resolve) => {
                    const startTime = Date.now();
                    const debugLogs = [];
                    const sshArgs = [
                        '-o',
                        'GSSAPIAuthentication=yes',
                        '-o',
                        'PreferredAuthentications=gssapi-with-mic,gssapi-keyex',
                        '-o',
                        'StrictHostKeyChecking=accept-new',
                        '-o',
                        'BatchMode=yes',
                        '-o',
                        'ConnectTimeout=10',
                        '-v', // Verbose for debug logs
                        '-p',
                        String(config.port),
                        '-l',
                        config.username,
                        config.host,
                        'echo __EMDASH_SSH_OK__',
                    ];
                    (0, child_process_1.execFile)('ssh', sshArgs, {
                        timeout: 15000,
                        env: {
                            ...process.env,
                            KRB5CCNAME: process.env.KRB5CCNAME || '',
                        },
                    }, (err, stdout, stderr) => {
                        const latency = Date.now() - startTime;
                        // Capture verbose ssh output as debug logs
                        if (stderr) {
                            debugLogs.push(...stderr.split('\n').filter(Boolean));
                        }
                        if (stdout && stdout.includes('__EMDASH_SSH_OK__')) {
                            resolve({ success: true, latency, debugLogs });
                        }
                        else {
                            const errorMsg = err?.message || stderr?.trim() || 'GSSAPI authentication failed';
                            resolve({ success: false, error: errorMsg, debugLogs });
                        }
                    });
                });
            }
            const { Client } = await Promise.resolve().then(() => __importStar(require('ssh2')));
            const debugLogs = [];
            const testClient = new Client();
            return new Promise(async (resolve) => {
                const startTime = Date.now();
                testClient.on('ready', () => {
                    const latency = Date.now() - startTime;
                    testClient.end();
                    try {
                        proxyProc?.kill();
                    }
                    catch {
                        /* ignore */
                    }
                    resolve({ success: true, latency, debugLogs });
                });
                testClient.on('error', (err) => {
                    try {
                        proxyProc?.kill();
                    }
                    catch {
                        /* ignore */
                    }
                    resolve({ success: false, error: err.message, debugLogs });
                });
                testClient.on('keyboard-interactive', () => {
                    // Close the connection if keyboard-interactive auth is required
                    testClient.end();
                    resolve({
                        success: false,
                        error: 'Keyboard-interactive authentication not supported',
                        debugLogs,
                    });
                });
                const connectConfig = {
                    host: config.host,
                    port: config.port,
                    username: config.username,
                    readyTimeout: 10000,
                    debug: (info) => debugLogs.push(info),
                };
                if (config.authType === 'password') {
                    connectConfig.password = config.password;
                }
                else if (config.authType === 'key' && config.privateKeyPath) {
                    const fs = require('fs');
                    const os = require('os');
                    try {
                        // Expand ~ to home directory
                        let keyPath = config.privateKeyPath;
                        if (keyPath.startsWith('~/')) {
                            keyPath = keyPath.replace('~', os.homedir());
                        }
                        else if (keyPath === '~') {
                            keyPath = os.homedir();
                        }
                        connectConfig.privateKey = fs.readFileSync(keyPath);
                        if (config.passphrase) {
                            connectConfig.passphrase = config.passphrase;
                        }
                    }
                    catch (err) {
                        resolve({
                            success: false,
                            error: `Failed to read private key: ${err.message}`,
                            debugLogs,
                        });
                        return;
                    }
                }
                else if (config.authType === 'agent') {
                    const identityAgent = await (0, sshConfigParser_1.resolveIdentityAgent)(config.host);
                    connectConfig.agent = identityAgent || process.env.SSH_AUTH_SOCK;
                    debugLogs.push(`[emdash] authType=agent, socket=${connectConfig.agent ?? '(not found)'}`);
                }
                debugLogs.push(`[emdash] authType=${config.authType}, host=${config.host}, port=${config.port}, username=${config.username}`);
                // Check for ProxyCommand in ~/.ssh/config
                const proxyCommand = await (0, sshConfigParser_1.resolveProxyCommand)(config.host, config.port);
                debugLogs.push(`[emdash] ProxyCommand resolve: ${proxyCommand ?? '(none)'}`);
                let proxyProc;
                if (proxyCommand) {
                    const { Duplex } = await Promise.resolve().then(() => __importStar(require('stream')));
                    const { spawn } = await Promise.resolve().then(() => __importStar(require('child_process')));
                    proxyProc = spawn('sh', ['-c', proxyCommand], {
                        stdio: ['pipe', 'pipe', 'pipe'],
                    });
                    const sock = new Duplex({
                        read() { },
                        write(chunk, encoding, callback) {
                            return proxyProc.stdin.write(chunk, encoding, callback);
                        },
                        final(callback) {
                            proxyProc.stdin.end(callback);
                        },
                    });
                    proxyProc.stdout.on('data', (data) => sock.push(data));
                    proxyProc.stdout.on('close', () => sock.push(null));
                    proxyProc.stderr.on('data', (data) => {
                        debugLogs.push(`[emdash] proxy stderr: ${data.toString()}`);
                    });
                    proxyProc.on('error', (err) => {
                        debugLogs.push(`[emdash] proxy error: ${err.message}`);
                        sock.destroy(err);
                    });
                    connectConfig.sock = sock;
                }
                testClient.connect(connectConfig);
            });
        }
        catch (err) {
            console.error('[sshIpc] Test connection error:', err);
            return { success: false, error: err.message };
        }
    });
    // Save connection
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.SAVE_CONNECTION, async (_, config) => {
        try {
            const { db } = await (0, drizzleClient_1.getDrizzleClient)();
            // Generate ID if not provided
            const connectionId = config.id ?? `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            // Save credentials first (secure keychain storage)
            if (config.password) {
                await credentialService.storePassword(connectionId, config.password);
            }
            if (config.passphrase) {
                await credentialService.storePassphrase(connectionId, config.passphrase);
            }
            // Strip sensitive data before saving to DB
            const { password: _password, passphrase: _passphrase, ...dbConfig } = config;
            const insertData = {
                id: connectionId,
                name: dbConfig.name,
                host: dbConfig.host,
                port: dbConfig.port,
                username: dbConfig.username,
                authType: dbConfig.authType,
                privateKeyPath: dbConfig.privateKeyPath,
                useAgent: dbConfig.useAgent ? 1 : 0,
            };
            // Insert or update
            await db
                .insert(schema_1.sshConnections)
                .values(insertData)
                .onConflictDoUpdate({
                target: schema_1.sshConnections.id,
                set: {
                    name: insertData.name,
                    host: insertData.host,
                    port: insertData.port,
                    username: insertData.username,
                    authType: insertData.authType,
                    privateKeyPath: insertData.privateKeyPath,
                    useAgent: insertData.useAgent,
                    updatedAt: new Date().toISOString(),
                },
            });
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('ssh_connection_saved', { type: config.authType });
            });
            return {
                success: true,
                connection: {
                    ...dbConfig,
                    id: connectionId,
                },
            };
        }
        catch (err) {
            console.error('[sshIpc] Save connection error:', err);
            return { success: false, error: err.message };
        }
    });
    // Get connections
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.GET_CONNECTIONS, async () => {
        try {
            const { db } = await (0, drizzleClient_1.getDrizzleClient)();
            const rows = await db
                .select({
                id: schema_1.sshConnections.id,
                name: schema_1.sshConnections.name,
                host: schema_1.sshConnections.host,
                port: schema_1.sshConnections.port,
                username: schema_1.sshConnections.username,
                authType: schema_1.sshConnections.authType,
                privateKeyPath: schema_1.sshConnections.privateKeyPath,
                useAgent: schema_1.sshConnections.useAgent,
            })
                .from(schema_1.sshConnections)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.sshConnections.updatedAt));
            return {
                success: true,
                connections: rows.map(mapRowToConfig),
            };
        }
        catch (err) {
            console.error('[sshIpc] Get connections error:', err);
            return { success: false, error: err.message };
        }
    });
    // Delete connection
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.DELETE_CONNECTION, async (_, id) => {
        try {
            // Stop monitoring BEFORE disconnecting so the monitor's
            // handleDisconnect listener doesn't trigger a reconnect.
            monitor.stopMonitoring(id);
            if (SshService_1.sshService.isConnected(id)) {
                try {
                    await SshService_1.sshService.disconnect(id);
                }
                catch {
                    // Best-effort: continue with deletion even if disconnect fails
                }
            }
            const { db } = await (0, drizzleClient_1.getDrizzleClient)();
            // Delete credentials
            await credentialService.deleteAllCredentials(id);
            // Delete from database
            await db.delete(schema_1.sshConnections).where((0, drizzle_orm_1.eq)(schema_1.sshConnections.id, id));
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('ssh_connection_deleted');
            });
            return { success: true };
        }
        catch (err) {
            console.error('[sshIpc] Delete connection error:', err);
            return { success: false, error: err.message };
        }
    });
    // Connect
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.CONNECT, async (_, arg) => {
        try {
            // Accept either a saved connection id (string) or a config object.
            if (typeof arg === 'string') {
                const id = arg;
                const { db } = await (0, drizzleClient_1.getDrizzleClient)();
                const rows = await db
                    .select({
                    id: schema_1.sshConnections.id,
                    name: schema_1.sshConnections.name,
                    host: schema_1.sshConnections.host,
                    port: schema_1.sshConnections.port,
                    username: schema_1.sshConnections.username,
                    authType: schema_1.sshConnections.authType,
                    privateKeyPath: schema_1.sshConnections.privateKeyPath,
                    useAgent: schema_1.sshConnections.useAgent,
                })
                    .from(schema_1.sshConnections)
                    .where((0, drizzle_orm_1.eq)(schema_1.sshConnections.id, id))
                    .limit(1);
                const row = rows[0];
                if (!row) {
                    return { success: false, error: `SSH connection not found: ${id}` };
                }
                const loadedConfig = mapRowToConfig(row);
                const connectionId = await SshService_1.sshService.connect(loadedConfig);
                // startMonitoring is a no-op if already tracked; updateState
                // is a no-op if not tracked. Call both to handle fresh connects
                // and re-connects after the monitor gave up (state = disconnected).
                monitor.startMonitoring(connectionId, loadedConfig);
                monitor.updateState(connectionId, 'connected');
                void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                    void capture('ssh_connect_success', { type: loadedConfig.authType });
                });
                return { success: true, connectionId };
            }
            if (!arg || typeof arg !== 'object') {
                return { success: false, error: 'Invalid SSH connect request' };
            }
            const config = arg;
            const effectiveId = config.id ?? (0, crypto_1.randomUUID)();
            // If secrets are provided inline, store them for this id.
            if (config.authType === 'password' && typeof config.password === 'string') {
                await credentialService.storePassword(effectiveId, config.password);
            }
            if (config.authType === 'key' &&
                typeof config.passphrase === 'string' &&
                config.passphrase) {
                await credentialService.storePassphrase(effectiveId, config.passphrase);
            }
            // Load credentials from keychain if needed
            let password = config.password;
            let passphrase = config.passphrase;
            if (config.authType === 'password' && !password) {
                password = (await credentialService.getPassword(effectiveId)) ?? undefined;
            }
            if (config.authType === 'key' && !passphrase) {
                passphrase = (await credentialService.getPassphrase(effectiveId)) ?? undefined;
            }
            const fullConfig = {
                ...config,
                id: effectiveId,
                password,
                passphrase,
            };
            const connectionId = await SshService_1.sshService.connect(fullConfig);
            monitor.startMonitoring(connectionId, fullConfig);
            monitor.updateState(connectionId, 'connected');
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('ssh_connect_success', { type: config.authType });
            });
            return { success: true, connectionId };
        }
        catch (err) {
            console.error('[sshIpc] Connection error:', err);
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('ssh_connect_failed', { error_type: classifySshError(err) });
            });
            return { success: false, error: err.message };
        }
    });
    // Disconnect
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.DISCONNECT, async (_, connectionId) => {
        try {
            // Stop monitoring BEFORE disconnecting so the monitor's
            // handleDisconnect listener doesn't trigger a reconnect
            // for an intentional disconnect.
            monitor.stopMonitoring(connectionId);
            await SshService_1.sshService.disconnect(connectionId);
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('ssh_disconnected');
            });
            return { success: true };
        }
        catch (err) {
            console.error('[sshIpc] Disconnect error:', err);
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.EXECUTE_COMMAND, async (_, connectionId, command, cwd) => {
        try {
            const trimmed = command.trimStart();
            const validationError = (0, sshCommandValidation_1.getSshExecuteCommandValidationError)(command);
            if (validationError) {
                console.warn(`[sshIpc] Blocked disallowed command: ${trimmed.slice(0, 80)}`);
                return { success: false, error: validationError };
            }
            const result = await SshService_1.sshService.executeCommand(connectionId, command, cwd);
            return { success: true, ...result };
        }
        catch (error) {
            console.error('[sshIpc] Execute command error:', error);
            return { success: false, error: error.message };
        }
    });
    // List files
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.LIST_FILES, async (_, connectionId, path) => {
        try {
            // Validate path to prevent browsing sensitive directories
            if (!isPathSafe(path)) {
                return { success: false, error: 'Access denied: path is restricted' };
            }
            // GSSAPI connections use command-based file operations
            if (SshService_1.sshService.isGssapiConnection(connectionId)) {
                const result = await SshService_1.sshService.executeCommand(connectionId, `ls -la --time-style=+%s ${(0, shellEscape_1.quoteShellArg)(path)} 2>/dev/null`);
                if (result.exitCode !== 0) {
                    return { success: false, error: `Failed to list files: ${result.stderr}` };
                }
                const entries = [];
                for (const line of result.stdout.split('\n')) {
                    // Parse ls -la output: permissions links owner group size timestamp name
                    const match = line.match(/^([dlscp-])([rwxsStT-]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d+)\s+(.+)$/);
                    if (!match)
                        continue;
                    const [, typeChar, perms, sizeStr, mtimeStr, name] = match;
                    if (name === '.' || name === '..')
                        continue;
                    let type = 'file';
                    if (typeChar === 'd')
                        type = 'directory';
                    else if (typeChar === 'l')
                        type = 'symlink';
                    entries.push({
                        path: `${path}/${name}`.replace(/\/+/g, '/'),
                        name,
                        type,
                        size: parseInt(sizeStr, 10),
                        modifiedAt: new Date(parseInt(mtimeStr, 10) * 1000),
                        permissions: perms,
                    });
                }
                return { success: true, files: entries };
            }
            const sftp = await SshService_1.sshService.getSftp(connectionId);
            return new Promise((resolve) => {
                sftp.readdir(path, (err, list) => {
                    if (err) {
                        resolve({ success: false, error: `Failed to list files: ${err.message}` });
                        return;
                    }
                    const entries = list.map((item) => {
                        const isDirectory = item.attrs.isDirectory();
                        const isSymlink = item.attrs.isSymbolicLink();
                        let type = 'file';
                        if (isDirectory)
                            type = 'directory';
                        else if (isSymlink)
                            type = 'symlink';
                        return {
                            path: `${path}/${item.filename}`.replace(/\/+/g, '/'),
                            name: item.filename,
                            type,
                            size: item.attrs.size,
                            modifiedAt: new Date(item.attrs.mtime * 1000),
                            permissions: item.attrs.mode?.toString(8),
                        };
                    });
                    resolve({ success: true, files: entries });
                });
            });
        }
        catch (error) {
            console.error('[sshIpc] List files error:', error);
            return { success: false, error: error.message };
        }
    });
    // Read file
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.READ_FILE, async (_, connectionId, path) => {
        try {
            // Validate path to prevent access to sensitive files
            if (!isPathSafe(path)) {
                return { success: false, error: 'Access denied: path is restricted' };
            }
            // GSSAPI connections use command-based file operations
            if (SshService_1.sshService.isGssapiConnection(connectionId)) {
                const result = await SshService_1.sshService.executeCommand(connectionId, `cat ${(0, shellEscape_1.quoteShellArg)(path)}`);
                if (result.exitCode !== 0) {
                    return { success: false, error: `Failed to read file: ${result.stderr}` };
                }
                return { success: true, content: result.stdout };
            }
            const sftp = await SshService_1.sshService.getSftp(connectionId);
            return new Promise((resolve) => {
                sftp.readFile(path, 'utf-8', (err, data) => {
                    if (err) {
                        resolve({ success: false, error: `Failed to read file: ${err.message}` });
                        return;
                    }
                    resolve({ success: true, content: data.toString() });
                });
            });
        }
        catch (error) {
            console.error('[sshIpc] Read file error:', error);
            return { success: false, error: error.message };
        }
    });
    // Write file
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.WRITE_FILE, async (_, connectionId, path, content) => {
        try {
            // Validate path to prevent writing to sensitive files
            if (!isPathSafe(path)) {
                return { success: false, error: 'Access denied: path is restricted' };
            }
            // GSSAPI connections use command-based file operations
            if (SshService_1.sshService.isGssapiConnection(connectionId)) {
                const encoded = Buffer.from(content, 'utf-8').toString('base64');
                const result = await SshService_1.sshService.executeCommand(connectionId, `echo ${(0, shellEscape_1.quoteShellArg)(encoded)} | base64 -d > ${(0, shellEscape_1.quoteShellArg)(path)}`);
                if (result.exitCode !== 0) {
                    return { success: false, error: `Failed to write file: ${result.stderr}` };
                }
                return { success: true };
            }
            const sftp = await SshService_1.sshService.getSftp(connectionId);
            return new Promise((resolve) => {
                sftp.writeFile(path, content, 'utf-8', (err) => {
                    if (err) {
                        resolve({ success: false, error: `Failed to write file: ${err.message}` });
                        return;
                    }
                    resolve({ success: true });
                });
            });
        }
        catch (error) {
            console.error('[sshIpc] Write file error:', error);
            return { success: false, error: error.message };
        }
    });
    // Get state
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.GET_STATE, async (_, connectionId) => {
        try {
            const state = monitor.getState(connectionId);
            return { success: true, state };
        }
        catch (err) {
            console.error('[sshIpc] Get state error:', err);
            return { success: false, error: err.message };
        }
    });
    // Get SSH config hosts from ~/.ssh/config
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.GET_SSH_CONFIG, async () => {
        try {
            const hosts = await (0, sshConfigParser_1.parseSshConfigFile)();
            // Filter out wildcard patterns (Host *, Host ?) — not useful in host dropdowns
            const concreteHosts = hosts.filter((h) => !h.host.includes('*') && !h.host.includes('?'));
            return { success: true, hosts: concreteHosts };
        }
        catch (err) {
            console.error('[sshIpc] Get SSH config error:', err);
            return { success: false, error: err.message };
        }
    });
    // Get a specific SSH config host by alias
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.GET_SSH_CONFIG_HOST, async (_, hostAlias) => {
        try {
            if (!hostAlias || typeof hostAlias !== 'string') {
                return { success: false, error: 'Host alias is required' };
            }
            const hosts = await (0, sshConfigParser_1.parseSshConfigFile)();
            const host = hosts
                .filter((h) => !h.host.includes('*') && !h.host.includes('?'))
                .find((h) => h.host.toLowerCase() === hostAlias.toLowerCase());
            if (!host) {
                return { success: false, error: `Host alias not found: ${hostAlias}` };
            }
            return { success: true, host };
        }
        catch (err) {
            console.error('[sshIpc] Get SSH config host error:', err);
            return { success: false, error: err.message };
        }
    });
    // Check if a remote path is a git repository
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.CHECK_IS_GIT_REPO, async (_, connectionId, remotePath) => {
        try {
            if (!remotePath || !remotePath.startsWith('/')) {
                return { success: false, error: 'An absolute remote path is required' };
            }
            if (!isPathSafe(remotePath)) {
                return { success: false, error: 'Access denied: path is restricted' };
            }
            const result = await SshService_1.sshService.executeCommand(connectionId, `git -C ${(0, shellEscape_1.quoteShellArg)(remotePath)} rev-parse --is-inside-work-tree 2>/dev/null`);
            const isGitRepo = result.exitCode === 0 && result.stdout.trim() === 'true';
            return { success: true, isGitRepo };
        }
        catch (err) {
            console.error('[sshIpc] Check git repo error:', err);
            return { success: false, error: err.message };
        }
    });
    // Initialize a new git repository on the remote machine
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.INIT_REPO, async (_, connectionId, parentPath, repoName) => {
        try {
            if (!parentPath || !parentPath.startsWith('/')) {
                return { success: false, error: 'An absolute parent path is required' };
            }
            if (!isPathSafe(parentPath)) {
                return { success: false, error: 'Access denied: path is restricted' };
            }
            // Validate repo name: alphanumeric, hyphens, underscores, dots
            if (!repoName || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(repoName)) {
                return {
                    success: false,
                    error: 'Invalid repository name. Use letters, numbers, hyphens, underscores, and dots. Must start with a letter or number.',
                };
            }
            const repoPath = `${parentPath.replace(/\/+$/, '')}/${repoName}`;
            if (!isPathSafe(repoPath)) {
                return { success: false, error: 'Access denied: target path is restricted' };
            }
            // Check if directory already exists
            const checkResult = await SshService_1.sshService.executeCommand(connectionId, `test -d ${(0, shellEscape_1.quoteShellArg)(repoPath)} && echo exists || echo absent`);
            if (checkResult.stdout.trim() === 'exists') {
                return { success: false, error: `Directory already exists: ${repoPath}` };
            }
            // Create directory and initialize git repo
            const initResult = await SshService_1.sshService.executeCommand(connectionId, `mkdir -p ${(0, shellEscape_1.quoteShellArg)(repoPath)} && git -C ${(0, shellEscape_1.quoteShellArg)(repoPath)} init`);
            if (initResult.exitCode !== 0) {
                return {
                    success: false,
                    error: `Failed to initialize repository: ${initResult.stderr || initResult.stdout}`,
                };
            }
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('ssh_repo_init');
            });
            return { success: true, path: repoPath };
        }
        catch (err) {
            console.error('[sshIpc] Init repo error:', err);
            return { success: false, error: err.message };
        }
    });
    // Clone a repository on the remote machine
    electron_1.ipcMain.handle(types_1.SSH_IPC_CHANNELS.CLONE_REPO, async (_, connectionId, repoUrl, targetPath) => {
        try {
            if (!repoUrl || typeof repoUrl !== 'string') {
                return { success: false, error: 'Repository URL is required' };
            }
            // Validate URL format
            const urlPatterns = [/^https?:\/\/.+/i, /^git@.+:.+/i, /^ssh:\/\/.+/i];
            if (!urlPatterns.some((p) => p.test(repoUrl.trim()))) {
                return {
                    success: false,
                    error: 'Invalid repository URL. Use https://, git@, or ssh:// format.',
                };
            }
            if (!targetPath || !targetPath.startsWith('/')) {
                return { success: false, error: 'An absolute target path is required' };
            }
            if (!isPathSafe(targetPath)) {
                return { success: false, error: 'Access denied: path is restricted' };
            }
            // Check if target already exists
            const checkResult = await SshService_1.sshService.executeCommand(connectionId, `test -e ${(0, shellEscape_1.quoteShellArg)(targetPath)} && echo exists || echo absent`);
            if (checkResult.stdout.trim() === 'exists') {
                return { success: false, error: `Target path already exists: ${targetPath}` };
            }
            // Ensure parent directory exists
            const parentDir = targetPath.replace(/\/[^/]+\/?$/, '') || '/';
            await SshService_1.sshService.executeCommand(connectionId, `mkdir -p ${(0, shellEscape_1.quoteShellArg)(parentDir)}`);
            // Clone the repository
            const cloneResult = await SshService_1.sshService.executeCommand(connectionId, `git clone ${(0, shellEscape_1.quoteShellArg)(repoUrl.trim())} ${(0, shellEscape_1.quoteShellArg)(targetPath)}`);
            if (cloneResult.exitCode !== 0) {
                return {
                    success: false,
                    error: `Clone failed: ${cloneResult.stderr || cloneResult.stdout}`,
                };
            }
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('ssh_repo_clone');
            });
            return { success: true, path: targetPath };
        }
        catch (err) {
            console.error('[sshIpc] Clone repo error:', err);
            return { success: false, error: err.message };
        }
    });
}
