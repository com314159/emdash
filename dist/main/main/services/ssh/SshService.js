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
exports.sshService = exports.SshService = void 0;
const events_1 = require("events");
const ssh2_1 = require("ssh2");
const SshCredentialService_1 = require("./SshCredentialService");
const shellEscape_1 = require("../../utils/shellEscape");
const promises_1 = require("fs/promises");
const crypto_1 = require("crypto");
const os_1 = require("os");
const path_1 = require("path");
const child_process_1 = require("child_process");
const promises_2 = require("fs/promises");
const sshConfigParser_1 = require("../../utils/sshConfigParser");
/** Maximum number of concurrent SSH connections allowed in the pool. */
const MAX_CONNECTIONS = 10;
/** Threshold (fraction of MAX_CONNECTIONS) at which a warning is logged. */
const POOL_WARNING_THRESHOLD = 0.8;
/**
 * Main SSH service for managing SSH connections, executing commands,
 * and handling SFTP operations.
 *
 * Extends EventEmitter to emit connection events:
 * - 'connected': When a connection is successfully established
 * - 'error': When a connection error occurs
 * - 'disconnected': When a connection is closed
 */
class SshService extends events_1.EventEmitter {
    constructor(credentialService) {
        super();
        this.connections = {};
        this.gssapiConnections = new Map();
        this.gssapiProcesses = new Map();
        this.pendingConnections = new Map();
        this.proxyProcesses = new Map();
        this.credentialService = credentialService ?? new SshCredentialService_1.SshCredentialService();
    }
    /**
     * Establishes a new SSH connection.
     *
     * Guards against duplicate connections:
     * - If a connection with this ID already exists and is alive, returns immediately.
     * - If a connection attempt for this ID is already in flight, coalesces onto
     *   the existing promise instead of opening a second TCP socket.
     * - Enforces a global MAX_CONNECTIONS limit to prevent resource exhaustion.
     *
     * @param config - SSH connection configuration
     * @returns Connection ID for future operations
     */
    async connect(config) {
        const connectionId = config.id ?? (0, crypto_1.randomUUID)();
        // 1. If already connected, reuse the existing connection
        if (this.connections[connectionId] || this.gssapiConnections.has(connectionId)) {
            return connectionId;
        }
        // 2. If a connection attempt is already in flight, coalesce
        const pending = this.pendingConnections.get(connectionId);
        if (pending) {
            return pending;
        }
        // 3. Enforce connection pool limit
        const poolSize = Object.keys(this.connections).length +
            this.gssapiConnections.size +
            this.pendingConnections.size;
        if (poolSize >= MAX_CONNECTIONS) {
            throw new Error(`SSH connection pool limit reached (${MAX_CONNECTIONS}). ` +
                'Disconnect unused connections before opening new ones.');
        }
        if (poolSize >= MAX_CONNECTIONS * POOL_WARNING_THRESHOLD) {
            console.warn(`[SshService] Connection pool at ${poolSize}/${MAX_CONNECTIONS} — approaching limit`);
        }
        // 4. GSSAPI uses system ssh with ControlMaster instead of ssh2
        if (config.authType === 'gssapi') {
            const connectionPromise = this.connectGssapi(connectionId, config);
            this.pendingConnections.set(connectionId, connectionPromise);
            try {
                return await connectionPromise;
            }
            finally {
                this.pendingConnections.delete(connectionId);
            }
        }
        // 5. Create the ssh2 connection and track the in-flight promise
        const connectionPromise = this.createConnection(connectionId, config);
        this.pendingConnections.set(connectionId, connectionPromise);
        try {
            const result = await connectionPromise;
            return result;
        }
        finally {
            this.pendingConnections.delete(connectionId);
        }
    }
    /**
     * Internal: opens a new SSH connection and registers it in the pool.
     */
    createConnection(connectionId, config) {
        const client = new ssh2_1.Client();
        return new Promise((resolve, reject) => {
            // Handle connection errors
            client.on('error', (err) => {
                // Clean up any proxy process for this failed connection
                const proxyProc = this.proxyProcesses.get(connectionId);
                if (proxyProc) {
                    try {
                        proxyProc.kill();
                    }
                    catch {
                        /* ignore */
                    }
                    this.proxyProcesses.delete(connectionId);
                }
                reject(err);
            });
            // Handle connection close
            client.on('close', () => {
                // Only clean up if this client is still the one stored in the pool.
                // A stale client's close event must not remove a newer connection
                // that was established under the same connectionId.
                if (this.connections[connectionId]?.client === client) {
                    delete this.connections[connectionId];
                    const proxyProc = this.proxyProcesses.get(connectionId);
                    if (proxyProc) {
                        try {
                            proxyProc.kill();
                        }
                        catch {
                            /* ignore */
                        }
                        this.proxyProcesses.delete(connectionId);
                    }
                    this.emit('disconnected', connectionId);
                }
            });
            // Handle successful connection
            client.on('ready', () => {
                const connection = {
                    id: connectionId,
                    config,
                    client,
                    connectedAt: new Date(),
                    lastActivity: new Date(),
                };
                this.connections[connectionId] = connection;
                this.emit('connected', connectionId);
                resolve(connectionId);
            });
            // Build connection config
            this.buildConnectConfig(connectionId, config)
                .then((connectConfig) => {
                // Track proxy process for cleanup on disconnect
                const proxyProc = connectConfig._proxyProcess;
                if (proxyProc) {
                    this.proxyProcesses.set(connectionId, proxyProc);
                    delete connectConfig._proxyProcess;
                }
                client.connect(connectConfig);
            })
                .catch((err) => {
                // Never emit the special EventEmitter 'error' event unless
                // someone is explicitly listening; otherwise Node will throw
                // ERR_UNHANDLED_ERROR and can abort IPC replies.
                if (this.listenerCount('error') > 0) {
                    this.emit('error', connectionId, err);
                }
                reject(err);
            });
        });
    }
    /**
     * Builds the ssh2 ConnectConfig from our SshConfig
     */
    async buildConnectConfig(connectionId, config) {
        const connectConfig = {
            host: config.host,
            port: config.port,
            username: config.username,
            readyTimeout: 20000,
            keepaliveInterval: 60000,
            keepaliveCountMax: 3,
        };
        // Check for ProxyCommand in ~/.ssh/config
        const proxyCommand = await (0, sshConfigParser_1.resolveProxyCommand)(config.host, config.port);
        if (proxyCommand) {
            const { Duplex } = await Promise.resolve().then(() => __importStar(require('stream')));
            const proxyProc = (0, child_process_1.spawn)('sh', ['-c', proxyCommand], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            // Create a duplex stream bridging proxy stdout (read) and stdin (write)
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
            proxyProc.on('error', (err) => sock.destroy(err));
            connectConfig.sock = sock;
            connectConfig._proxyProcess = proxyProc;
        }
        switch (config.authType) {
            case 'password': {
                const inlinePassword = config.password;
                const password = inlinePassword ?? (await this.credentialService.getPassword(connectionId));
                if (!password) {
                    throw new Error(`No password found for connection ${connectionId}`);
                }
                connectConfig.password = password;
                break;
            }
            case 'key': {
                if (!config.privateKeyPath) {
                    throw new Error('Private key path is required for key authentication');
                }
                try {
                    // Expand ~ to home directory
                    let keyPath = config.privateKeyPath;
                    if (keyPath.startsWith('~/')) {
                        keyPath = keyPath.replace('~', (0, os_1.homedir)());
                    }
                    else if (keyPath === '~') {
                        keyPath = (0, os_1.homedir)();
                    }
                    const privateKey = await (0, promises_1.readFile)(keyPath, 'utf-8');
                    connectConfig.privateKey = privateKey;
                    // Check for passphrase
                    const inlinePassphrase = config.passphrase;
                    const passphrase = inlinePassphrase ?? (await this.credentialService.getPassphrase(connectionId));
                    if (passphrase) {
                        connectConfig.passphrase = passphrase;
                    }
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    throw new Error(`Failed to read private key: ${message}`);
                }
                break;
            }
            case 'agent': {
                const identityAgent = await (0, sshConfigParser_1.resolveIdentityAgent)(config.host);
                const agentSocket = identityAgent || process.env.SSH_AUTH_SOCK;
                if (!agentSocket) {
                    throw new Error('SSH agent authentication failed: no agent socket found. ' +
                        'This typically happens when:\n' +
                        '1. The SSH agent is not running (try running "eval $(ssh-agent -s)" in your terminal)\n' +
                        '2. The app was launched from the GUI (Finder/Dock) instead of a terminal\n' +
                        '3. The SSH agent socket path could not be auto-detected\n\n' +
                        'Workarounds:\n' +
                        '• Add IdentityAgent to this host in ~/.ssh/config (e.g. for 1Password)\n' +
                        '• Launch Emdash from your terminal where SSH agent is already configured\n' +
                        '• Use SSH key authentication instead of agent authentication\n' +
                        '• Ensure your SSH agent is running and your keys are added (ssh-add -l)');
                }
                connectConfig.agent = agentSocket;
                break;
            }
            default: {
                throw new Error(`Unsupported authentication type: ${config.authType}`);
            }
        }
        return connectConfig;
    }
    /**
     * Establishes a GSSAPI/Kerberos SSH connection using system ssh with ControlMaster.
     * Since the ssh2 library doesn't support GSSAPI authentication, we use the system's
     * OpenSSH client which has native Kerberos support.
     */
    async connectGssapi(connectionId, config) {
        // First, try to detect and reuse the user's existing ControlMaster socket.
        // The user's ~/.ssh/config likely has ControlMaster=auto + ControlPath set up.
        // We can check if a working master exists by running `ssh -O check`.
        const existingSocket = await this.findExistingControlMaster(config);
        if (existingSocket) {
            console.log(`[SshService] Reusing existing ControlMaster socket for ${config.host}`);
            const gssapiConn = {
                id: connectionId,
                config,
                controlSocketPath: existingSocket,
                connectedAt: new Date(),
                lastActivity: new Date(),
            };
            this.gssapiConnections.set(connectionId, gssapiConn);
            this.emit('connected', connectionId);
            return connectionId;
        }
        // No existing ControlMaster — create our own
        const socketPath = (0, path_1.join)((0, os_1.tmpdir)(), `emdash-ssh-${connectionId}`);
        // Clean up any stale socket file
        try {
            await (0, promises_2.unlink)(socketPath);
        }
        catch {
            // Ignore if doesn't exist
        }
        // Don't use -f (background after auth) — it can hang on some systems when
        // stdio is piped because the forked child keeps pipe references open and
        // the 'close' event never fires.  Instead keep the process alive and poll
        // for the ControlMaster socket to become ready.
        const sshArgs = [
            '-N', // No remote command
            '-M', // ControlMaster mode
            '-S',
            socketPath,
            '-o',
            'GSSAPIAuthentication=yes',
            '-o',
            'GSSAPIDelegateCredentials=yes',
            '-o',
            'PreferredAuthentications=gssapi-with-mic,gssapi-keyex',
            '-o',
            'StrictHostKeyChecking=accept-new',
            '-o',
            'BatchMode=yes',
            '-o',
            'ConnectTimeout=15',
            // Override user's ControlMaster/ControlPath config to avoid conflicts
            '-o',
            `ControlPath=${socketPath}`,
            '-p',
            String(config.port),
            '-l',
            config.username,
            config.host,
        ];
        console.log(`[SshService] connectGssapi: creating own ControlMaster at ${socketPath}`);
        console.log(`[SshService] connectGssapi: ssh args: ${sshArgs.join(' ')}`);
        return new Promise((resolve, reject) => {
            let settled = false;
            // Timeout: if ssh hangs (e.g. ControlMaster conflict), reject after 20s
            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    console.error('[SshService] connectGssapi: timed out after 20s');
                    try {
                        proc.kill();
                    }
                    catch {
                        /* ignore */
                    }
                    reject(new Error('SSH GSSAPI connection timed out. Check your Kerberos ticket (run kinit) and SSH config.'));
                }
            }, 20000);
            const proc = (0, child_process_1.spawn)('ssh', sshArgs, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                },
            });
            let stderr = '';
            proc.stderr.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                console.log(`[SshService] connectGssapi stderr: ${chunk.trim()}`);
            });
            // Poll for the ControlMaster socket to become ready.
            // The ssh process stays alive (no -f), so we detect readiness by
            // checking the socket file exists and responds to `ssh -O check`.
            const pollInterval = setInterval(() => {
                if (settled) {
                    clearInterval(pollInterval);
                    return;
                }
                try {
                    const { statSync } = require('fs');
                    statSync(socketPath);
                }
                catch {
                    return; // Socket doesn't exist yet
                }
                // Socket file exists — verify the master is alive
                (0, child_process_1.execFile)('ssh', ['-O', 'check', '-S', socketPath, '-p', String(config.port), '-l', config.username, config.host], { timeout: 3000, env: { ...process.env } }, (err) => {
                    if (settled)
                        return;
                    if (!err) {
                        settled = true;
                        clearTimeout(timeout);
                        clearInterval(pollInterval);
                        console.log(`[SshService] connectGssapi: ControlMaster ready at ${socketPath}`);
                        const gssapiConn = {
                            id: connectionId,
                            config,
                            controlSocketPath: socketPath,
                            connectedAt: new Date(),
                            lastActivity: new Date(),
                        };
                        this.gssapiConnections.set(connectionId, gssapiConn);
                        this.emit('connected', connectionId);
                        resolve(connectionId);
                    }
                });
            }, 300);
            // If the process exits unexpectedly (auth failure), reject immediately.
            proc.on('close', (code) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                clearInterval(pollInterval);
                console.log(`[SshService] connectGssapi: ssh exited with code ${code}`);
                const errorMsg = stderr.trim() || `SSH GSSAPI authentication failed (exit code ${code})`;
                reject(new Error(errorMsg));
            });
            proc.on('error', (err) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                clearInterval(pollInterval);
                reject(new Error(`Failed to spawn ssh: ${err.message}`));
            });
            // Store reference for cleanup
            this.gssapiProcesses.set(connectionId, proc);
        });
    }
    /**
     * Try to find the user's existing ControlMaster socket for this host.
     * Resolves the effective ControlPath from ssh config, then checks if a master is alive.
     */
    async findExistingControlMaster(config) {
        try {
            // Use `ssh -G` to resolve the effective SSH config for this host
            const { execFile: execFileCb } = require('child_process');
            const resolvedConfig = await new Promise((resolve, reject) => {
                execFileCb('ssh', ['-G', '-p', String(config.port), '-l', config.username, config.host], { timeout: 5000, env: { ...process.env } }, (err, stdout) => {
                    if (err)
                        return reject(err);
                    resolve(stdout);
                });
            });
            // Extract controlpath from resolved config
            const controlPathMatch = resolvedConfig.match(/^controlpath\s+(.+)$/m);
            if (!controlPathMatch) {
                console.log('[SshService] No ControlPath found in SSH config');
                return null;
            }
            const controlPath = controlPathMatch[1].trim();
            if (controlPath === 'none') {
                return null;
            }
            console.log(`[SshService] Found ControlPath in SSH config: ${controlPath}`);
            // Check if a ControlMaster is alive at that path
            const checkResult = await new Promise((resolve) => {
                execFileCb('ssh', [
                    '-O',
                    'check',
                    '-S',
                    controlPath,
                    '-p',
                    String(config.port),
                    '-l',
                    config.username,
                    config.host,
                ], { timeout: 5000, env: { ...process.env } }, (err) => {
                    resolve(!err);
                });
            });
            if (checkResult) {
                console.log(`[SshService] Existing ControlMaster is alive at ${controlPath}`);
                return controlPath;
            }
            else {
                console.log('[SshService] No active ControlMaster found');
                return null;
            }
        }
        catch (err) {
            console.log('[SshService] findExistingControlMaster error:', err);
            return null;
        }
    }
    /**
     * Checks if a connection is using GSSAPI/Kerberos authentication.
     */
    isGssapiConnection(connectionId) {
        return this.gssapiConnections.has(connectionId);
    }
    /**
     * Gets the GSSAPI connection info (including ControlMaster socket path).
     */
    getGssapiConnection(connectionId) {
        return this.gssapiConnections.get(connectionId);
    }
    /**
     * Builds SSH args for GSSAPI ControlMaster connection reuse.
     */
    getGssapiSshArgs(connectionId) {
        const conn = this.gssapiConnections.get(connectionId);
        if (!conn)
            return undefined;
        return [
            '-S',
            conn.controlSocketPath,
            '-o',
            'ControlMaster=no',
            '-p',
            String(conn.config.port),
            '-l',
            conn.config.username,
            conn.config.host,
        ];
    }
    /**
     * Executes a command on a GSSAPI connection using the ControlMaster socket.
     */
    executeCommandGssapi(conn, command, cwd) {
        const innerCommand = cwd ? `cd ${(0, shellEscape_1.quoteShellArg)(cwd)} && ${command}` : command;
        const fullCommand = `bash -l -c ${(0, shellEscape_1.quoteShellArg)(innerCommand)}`;
        return new Promise((resolve, reject) => {
            (0, child_process_1.execFile)('ssh', [
                '-S',
                conn.controlSocketPath,
                '-o',
                'ControlMaster=no',
                '-p',
                String(conn.config.port),
                '-l',
                conn.config.username,
                conn.config.host,
                fullCommand,
            ], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
                if (err && 'code' in err && typeof err.code === 'number') {
                    // Command exited with non-zero code, still a valid result
                    resolve({
                        stdout: (stdout || '').trim(),
                        stderr: (stderr || '').trim(),
                        exitCode: err.code,
                    });
                }
                else if (err) {
                    reject(err);
                }
                else {
                    resolve({
                        stdout: (stdout || '').trim(),
                        stderr: (stderr || '').trim(),
                        exitCode: 0,
                    });
                }
            });
        });
    }
    /**
     * Disconnects a GSSAPI connection by terminating the ControlMaster.
     */
    async disconnectGssapi(connectionId) {
        const conn = this.gssapiConnections.get(connectionId);
        if (!conn)
            return;
        // Send exit command to ControlMaster
        try {
            await new Promise((resolve) => {
                (0, child_process_1.execFile)('ssh', ['-S', conn.controlSocketPath, '-O', 'exit', conn.config.host], { timeout: 5000 }, () => resolve() // Ignore errors, best-effort
                );
            });
        }
        catch {
            // Best-effort cleanup
        }
        // Clean up socket file
        try {
            await (0, promises_2.unlink)(conn.controlSocketPath);
        }
        catch {
            // Ignore
        }
        // Kill any lingering process
        const proc = this.gssapiProcesses.get(connectionId);
        if (proc && !proc.killed) {
            proc.kill();
        }
        this.gssapiProcesses.delete(connectionId);
        this.gssapiConnections.delete(connectionId);
        this.emit('disconnected', connectionId);
    }
    /**
     * Disconnects an existing SSH connection.
     * @param connectionId - ID of the connection to close
     */
    async disconnect(connectionId) {
        // Handle GSSAPI connections
        if (this.gssapiConnections.has(connectionId)) {
            return this.disconnectGssapi(connectionId);
        }
        const connection = this.connections[connectionId];
        if (!connection) {
            return; // Already disconnected or never existed
        }
        // Close SFTP session if open, waiting for close to complete
        if (connection.sftp) {
            try {
                await new Promise((resolve) => {
                    const sftp = connection.sftp;
                    const timeout = setTimeout(() => resolve(), 2000); // 2s safety timeout
                    sftp.once('close', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                    sftp.end();
                });
            }
            catch {
                // Ignore errors during SFTP close
            }
            connection.sftp = undefined;
        }
        // Close SSH client
        connection.client.end();
        // Kill proxy process if one was used
        const proxyProc = this.proxyProcesses.get(connectionId);
        if (proxyProc) {
            try {
                proxyProc.kill();
            }
            catch {
                /* ignore */
            }
            this.proxyProcesses.delete(connectionId);
        }
        // Remove from pool
        delete this.connections[connectionId];
        // Emit disconnected event
        this.emit('disconnected', connectionId);
    }
    /**
     * Executes a command on the remote host.
     * @param connectionId - ID of the active connection
     * @param command - Command to execute
     * @param cwd - Optional working directory
     * @returns Command execution result
     */
    async executeCommand(connectionId, command, cwd) {
        // Handle GSSAPI connections
        const gssapiConn = this.gssapiConnections.get(connectionId);
        if (gssapiConn) {
            gssapiConn.lastActivity = new Date();
            return this.executeCommandGssapi(gssapiConn, command, cwd);
        }
        const connection = this.connections[connectionId];
        if (!connection) {
            throw new Error(`Connection ${connectionId} not found`);
        }
        // Update last activity
        connection.lastActivity = new Date();
        // Build the command with optional cwd, wrapped in a login shell so that
        // ~/.ssh/config, ~/.gitconfig, and other user-level configuration files
        // are available (ssh2's client.exec() uses a non-login shell by default).
        const innerCommand = cwd ? `cd ${(0, shellEscape_1.quoteShellArg)(cwd)} && ${command}` : command;
        const fullCommand = `bash -l -c ${(0, shellEscape_1.quoteShellArg)(innerCommand)}`;
        return new Promise((resolve, reject) => {
            connection.client.exec(fullCommand, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }
                let stdout = '';
                let stderr = '';
                stream.on('close', (code) => {
                    // ssh2 reports `code` as null when a signal terminates the process.
                    // Keep ExecResult.exitCode as a number for simpler downstream typing.
                    const exitCode = code ?? -1;
                    resolve({
                        stdout: stdout.trim(),
                        stderr: stderr.trim(),
                        exitCode,
                    });
                });
                stream.on('data', (data) => {
                    stdout += data.toString('utf-8');
                });
                stream.stderr.on('data', (data) => {
                    stderr += data.toString('utf-8');
                });
                stream.on('error', (streamErr) => {
                    reject(streamErr);
                });
            });
        });
    }
    /**
     * Gets an SFTP session for file operations.
     * @param connectionId - ID of the active connection
     * @returns SFTP wrapper instance
     */
    async getSftp(connectionId) {
        if (this.gssapiConnections.has(connectionId)) {
            throw new Error('SFTP is not available for GSSAPI connections. Use executeCommand-based file operations instead.');
        }
        const connection = this.connections[connectionId];
        if (!connection) {
            throw new Error(`Connection ${connectionId} not found`);
        }
        // Return cached SFTP if available
        if (connection.sftp) {
            connection.lastActivity = new Date();
            return connection.sftp;
        }
        // Create new SFTP session
        return new Promise((resolve, reject) => {
            connection.client.sftp((err, sftp) => {
                if (err) {
                    reject(err);
                    return;
                }
                connection.sftp = sftp;
                connection.lastActivity = new Date();
                resolve(sftp);
            });
        });
    }
    /**
     * Gets connection info for a specific connection.
     * @param connectionId - ID of the connection
     * @returns Connection object or undefined if not found
     */
    getConnection(connectionId) {
        return this.connections[connectionId];
    }
    /**
     * Gets all active connections.
     * @returns Array of connection objects
     */
    getAllConnections() {
        return Object.values(this.connections);
    }
    /**
     * Checks if a connection is currently connected.
     * @param connectionId - ID of the connection
     * @returns True if connected
     */
    isConnected(connectionId) {
        return connectionId in this.connections || this.gssapiConnections.has(connectionId);
    }
    /**
     * Lists all active connection IDs.
     * @returns Array of connection IDs
     */
    listConnections() {
        return [...Object.keys(this.connections), ...this.gssapiConnections.keys()];
    }
    /**
     * Gets connection info for a specific connection.
     * @param connectionId - ID of the connection
     */
    getConnectionInfo(connectionId) {
        const conn = this.connections[connectionId];
        if (conn) {
            return { connectedAt: conn.connectedAt, lastActivity: conn.lastActivity };
        }
        const gssapiConn = this.gssapiConnections.get(connectionId);
        if (gssapiConn) {
            return { connectedAt: gssapiConn.connectedAt, lastActivity: gssapiConn.lastActivity };
        }
        return null;
    }
    /**
     * Disconnects all active connections.
     * Useful for cleanup on shutdown.
     */
    async disconnectAll() {
        const allIds = [...Object.keys(this.connections), ...this.gssapiConnections.keys()];
        const disconnectPromises = allIds.map((id) => this.disconnect(id).catch(() => {
            // Ignore errors during bulk disconnect
        }));
        await Promise.all(disconnectPromises);
    }
}
exports.SshService = SshService;
/** Module-level singleton — all main-process code should import this. */
exports.sshService = new SshService();
