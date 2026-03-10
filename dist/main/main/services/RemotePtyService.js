"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemotePtyService = void 0;
const events_1 = require("events");
const shellEscape_1 = require("../utils/shellEscape");
const waitForShellPrompt_1 = require("../utils/waitForShellPrompt");
const logger_1 = require("../lib/logger");
/**
 * Allowlist of shells that can be launched as remote PTYs.
 * Only absolute paths to well-known shells are permitted.
 */
const ALLOWED_SHELLS = new Set([
    '/bin/bash',
    '/bin/sh',
    '/bin/zsh',
    '/usr/bin/bash',
    '/usr/bin/zsh',
    '/usr/bin/fish',
    '/usr/local/bin/bash',
    '/usr/local/bin/zsh',
    '/usr/local/bin/fish',
]);
/**
 * Service for managing remote PTY (pseudo-terminal) sessions over SSH.
 *
 * This service allows running interactive shell sessions on remote machines,
 * including AI agent CLIs like Codex, Claude, etc. It provides:
 * - Interactive shell sessions via ssh2
 * - Environment variable support
 * - Working directory configuration
 * - Auto-approve flag support for agents
 * - Proper cleanup on exit
 */
class RemotePtyService extends events_1.EventEmitter {
    constructor(sshService) {
        super();
        this.sshService = sshService;
        this.ptys = new Map();
        this.promptHandles = new Map();
    }
    /**
     * Starts a new remote PTY session on an established SSH connection.
     *
     * @param options - Configuration for the remote PTY session
     * @returns The created RemotePty instance
     * @throws Error if connection not found or shell creation fails
     */
    async startRemotePty(options) {
        // Build the remote command (shared between ssh2 and GSSAPI paths)
        const envEntries = Object.entries(options.env || {}).filter(([k]) => {
            if (!(0, shellEscape_1.isValidEnvVarName)(k)) {
                console.warn(`[RemotePtyService] Skipping invalid env var name: ${k}`);
                return false;
            }
            return true;
        });
        const envVars = envEntries.map(([k, v]) => `export ${k}=${(0, shellEscape_1.quoteShellArg)(v)}`).join(' && ');
        const cdCommand = options.cwd ? `cd ${(0, shellEscape_1.quoteShellArg)(options.cwd)}` : '';
        const autoApproveFlag = options.autoApprove ? ' --full-auto' : '';
        // Validate shell against allowlist (HIGH #5)
        const shellBinary = options.shell.split(/\s+/)[0];
        if (!ALLOWED_SHELLS.has(shellBinary)) {
            throw new Error(`Shell not allowed: ${shellBinary}. Allowed: ${[...ALLOWED_SHELLS].join(', ')}`);
        }
        const fullCommand = [envVars, cdCommand, `${options.shell}${autoApproveFlag}`]
            .filter(Boolean)
            .join(' && ');
        // GSSAPI connections: spawn system ssh with ControlMaster socket
        if (this.sshService.isGssapiConnection(options.connectionId)) {
            return this.startGssapiPty(options, fullCommand);
        }
        // Standard ssh2 connections
        const connection = this.sshService.getConnection(options.connectionId);
        if (!connection) {
            throw new Error(`Connection ${options.connectionId} not found`);
        }
        const client = connection.client;
        return new Promise((resolve, reject) => {
            client.shell((err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }
                const sshSubscribe = (cb) => {
                    const handler = (data) => cb(data.toString());
                    stream.on('data', handler);
                    return () => {
                        stream.removeListener('data', handler);
                    };
                };
                const handles = [];
                this.promptHandles.set(options.id, handles);
                handles.push((0, waitForShellPrompt_1.waitForShellPrompt)({
                    subscribe: sshSubscribe,
                    write: (d) => {
                        if (options.initialPrompt) {
                            handles.push((0, waitForShellPrompt_1.waitForShellPrompt)({
                                subscribe: sshSubscribe,
                                write: (d2) => {
                                    stream.write(d2);
                                    this.promptHandles.delete(options.id);
                                },
                                data: options.initialPrompt + '\n',
                                onTimeout: () => logger_1.log.warn('[RemotePtyService] Agent prompt not detected, sending initial prompt anyway'),
                            }));
                        }
                        stream.write(d);
                        if (!options.initialPrompt) {
                            this.promptHandles.delete(options.id);
                        }
                    },
                    data: fullCommand + '\n',
                    onTimeout: () => logger_1.log.warn('[RemotePtyService] Shell prompt not detected, sending setup commands anyway'),
                }));
                const pty = {
                    id: options.id,
                    write: (data) => stream.write(data),
                    // ssh2 expects rows, cols, height, width
                    resize: (cols, rows) => stream.setWindow(rows, cols, 0, 0),
                    kill: () => stream.close(),
                    onData: (callback) => stream.on('data', (data) => callback(data.toString())),
                    onExit: (callback) => stream.on('close', () => callback(0)),
                };
                this.ptys.set(options.id, pty);
                stream.on('close', () => {
                    this.cancelPromptHandles(options.id);
                    this.ptys.delete(options.id);
                    this.emit('exit', options.id);
                });
                resolve(pty);
            });
        });
    }
    /**
     * Starts a remote PTY session for GSSAPI connections using system ssh with ControlMaster.
     */
    async startGssapiPty(options, remoteCommand) {
        const sshArgs = this.sshService.getGssapiSshArgs(options.connectionId);
        if (!sshArgs) {
            throw new Error(`GSSAPI connection ${options.connectionId} not found`);
        }
        // Use node-pty to spawn ssh -tt with the ControlMaster socket
        let pty;
        try {
            pty = require('node-pty');
        }
        catch (e) {
            throw new Error(`PTY unavailable: ${e?.message || String(e)}`);
        }
        const proc = pty.spawn('ssh', ['-tt', ...sshArgs, remoteCommand], {
            name: 'xterm-256color',
            cols: 120,
            rows: 32,
            env: {
                TERM: 'xterm-256color',
                HOME: process.env.HOME || require('os').homedir(),
                PATH: process.env.PATH || '',
                KRB5CCNAME: process.env.KRB5CCNAME || '',
            },
        });
        // Send initial prompt if provided
        if (options.initialPrompt) {
            setTimeout(() => {
                proc.write(options.initialPrompt + '\n');
            }, 500);
        }
        const remotePty = {
            id: options.id,
            write: (data) => proc.write(data),
            resize: (cols, rows) => proc.resize(cols, rows),
            kill: () => proc.kill(),
            onData: (callback) => proc.onData(callback),
            onExit: (callback) => proc.onExit(({ exitCode }) => callback(exitCode)),
        };
        this.ptys.set(options.id, remotePty);
        proc.onExit(() => {
            this.ptys.delete(options.id);
            this.emit('exit', options.id);
        });
        return remotePty;
    }
    /**
     * Writes data to a remote PTY session.
     *
     * @param ptyId - ID of the PTY session
     * @param data - Data to write
     */
    write(ptyId, data) {
        const pty = this.ptys.get(ptyId);
        if (pty) {
            pty.write(data);
        }
    }
    /**
     * Resizes a remote PTY session.
     *
     * @param ptyId - ID of the PTY session
     * @param cols - Number of columns
     * @param rows - Number of rows
     */
    resize(ptyId, cols, rows) {
        const pty = this.ptys.get(ptyId);
        if (pty) {
            pty.resize(cols, rows);
        }
    }
    cancelPromptHandles(ptyId) {
        const handles = this.promptHandles.get(ptyId);
        if (handles) {
            for (const h of handles)
                h.cancel();
            this.promptHandles.delete(ptyId);
        }
    }
    /**
     * Kills a remote PTY session.
     *
     * @param ptyId - ID of the PTY session
     */
    kill(ptyId) {
        const pty = this.ptys.get(ptyId);
        if (pty) {
            this.cancelPromptHandles(ptyId);
            pty.kill();
            this.ptys.delete(ptyId);
        }
    }
    /**
     * Gets a PTY session by ID.
     *
     * @param ptyId - ID of the PTY session
     * @returns The RemotePty instance or undefined
     */
    getPty(ptyId) {
        return this.ptys.get(ptyId);
    }
    /**
     * Checks if a PTY session exists.
     *
     * @param ptyId - ID of the PTY session
     * @returns true if the PTY exists
     */
    hasPty(ptyId) {
        return this.ptys.has(ptyId);
    }
}
exports.RemotePtyService = RemotePtyService;
