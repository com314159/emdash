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
const vitest_1 = require("vitest");
const child_process_1 = require("child_process");
const SshService_1 = require("../SshService");
const mockSpawn = child_process_1.spawn;
const mockExecFile = child_process_1.execFile;
// Mock ssh2 Client
const mockClientInstance = {
    on: vitest_1.vi.fn(),
    connect: vitest_1.vi.fn(),
    end: vitest_1.vi.fn(),
    exec: vitest_1.vi.fn(),
    sftp: vitest_1.vi.fn(),
};
vitest_1.vi.mock('ssh2', () => ({
    Client: vitest_1.vi.fn().mockImplementation(() => mockClientInstance),
}));
// Mock fs/promises
vitest_1.vi.mock('fs/promises', () => ({
    readFile: vitest_1.vi.fn(),
    unlink: vitest_1.vi.fn().mockResolvedValue(undefined),
    access: vitest_1.vi.fn().mockResolvedValue(undefined),
}));
// Mock crypto
vitest_1.vi.mock('crypto', () => ({
    randomUUID: vitest_1.vi.fn().mockReturnValue('test-uuid-123'),
}));
// Mock child_process
vitest_1.vi.mock('child_process', () => ({
    spawn: vitest_1.vi.fn(),
    execFile: vitest_1.vi.fn(),
}));
// Prevent keytar/native module loading through SshService's module-level singleton.
vitest_1.vi.mock('../SshCredentialService', () => ({
    SshCredentialService: class MockSshCredentialService {
        constructor() {
            this.getPassword = vitest_1.vi.fn();
            this.getPassphrase = vitest_1.vi.fn();
            this.storePassword = vitest_1.vi.fn();
            this.storePassphrase = vitest_1.vi.fn();
        }
    },
}));
(0, vitest_1.describe)('SshService', () => {
    let service;
    let mockCredentialService;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mockCredentialService = {
            getPassword: vitest_1.vi.fn(),
            getPassphrase: vitest_1.vi.fn(),
            storePassword: vitest_1.vi.fn(),
            storePassphrase: vitest_1.vi.fn(),
        };
        service = new SshService_1.SshService(mockCredentialService);
    });
    (0, vitest_1.describe)('buildConnectConfig - via connect method', () => {
        (0, vitest_1.it)('should build correct config for password authentication', async () => {
            const config = {
                id: 'conn-1',
                name: 'Test Connection',
                host: 'example.com',
                port: 22,
                username: 'testuser',
                authType: 'password',
            };
            mockCredentialService.getPassword.mockResolvedValue('testpassword');
            // Capture the connect config
            let capturedConfig;
            mockClientInstance.connect.mockImplementation((cfg) => {
                capturedConfig = cfg;
                // Simulate successful connection
                const readyHandler = mockClientInstance.on.mock.calls.find((call) => call[0] === 'ready')?.[1];
                if (readyHandler) {
                    setTimeout(() => readyHandler(), 0);
                }
            });
            await service.connect(config);
            (0, vitest_1.expect)(capturedConfig).toMatchObject({
                host: 'example.com',
                port: 22,
                username: 'testuser',
                password: 'testpassword',
                readyTimeout: 20000,
                keepaliveInterval: 60000,
                keepaliveCountMax: 3,
            });
        });
        (0, vitest_1.it)('should build correct config for key authentication', async () => {
            const { readFile } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            readFile.mockResolvedValue('-----BEGIN OPENSSH PRIVATE KEY-----');
            const config = {
                id: 'conn-2',
                name: 'Key Connection',
                host: 'example.com',
                port: 22,
                username: 'testuser',
                authType: 'key',
                privateKeyPath: '/home/user/.ssh/id_rsa',
            };
            mockCredentialService.getPassphrase.mockResolvedValue(null);
            let capturedConfig;
            mockClientInstance.connect.mockImplementation((cfg) => {
                capturedConfig = cfg;
                const readyHandler = mockClientInstance.on.mock.calls.find((call) => call[0] === 'ready')?.[1];
                if (readyHandler) {
                    setTimeout(() => readyHandler(), 0);
                }
            });
            await service.connect(config);
            (0, vitest_1.expect)(readFile).toHaveBeenCalledWith('/home/user/.ssh/id_rsa', 'utf-8');
            (0, vitest_1.expect)(capturedConfig).toMatchObject({
                host: 'example.com',
                privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
            });
        });
        (0, vitest_1.it)('should include passphrase for encrypted key', async () => {
            const { readFile } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            readFile.mockResolvedValue('-----BEGIN OPENSSH PRIVATE KEY-----');
            const config = {
                id: 'conn-3',
                name: 'Encrypted Key',
                host: 'example.com',
                port: 22,
                username: 'testuser',
                authType: 'key',
                privateKeyPath: '/home/user/.ssh/id_rsa',
            };
            mockCredentialService.getPassphrase.mockResolvedValue('keypassphrase');
            let capturedConfig;
            mockClientInstance.connect.mockImplementation((cfg) => {
                capturedConfig = cfg;
                const readyHandler = mockClientInstance.on.mock.calls.find((call) => call[0] === 'ready')?.[1];
                if (readyHandler) {
                    setTimeout(() => readyHandler(), 0);
                }
            });
            await service.connect(config);
            (0, vitest_1.expect)(capturedConfig).toMatchObject({
                privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
                passphrase: 'keypassphrase',
            });
        });
        (0, vitest_1.it)('should build correct config for agent authentication', async () => {
            const originalEnv = process.env.SSH_AUTH_SOCK;
            process.env.SSH_AUTH_SOCK = '/tmp/ssh-agent.sock';
            const config = {
                id: 'conn-4',
                name: 'Agent Connection',
                host: 'example.com',
                port: 22,
                username: 'testuser',
                authType: 'agent',
            };
            let capturedConfig;
            mockClientInstance.connect.mockImplementation((cfg) => {
                capturedConfig = cfg;
                const readyHandler = mockClientInstance.on.mock.calls.find((call) => call[0] === 'ready')?.[1];
                if (readyHandler) {
                    setTimeout(() => readyHandler(), 0);
                }
            });
            await service.connect(config);
            (0, vitest_1.expect)(capturedConfig).toMatchObject({
                agent: '/tmp/ssh-agent.sock',
            });
            process.env.SSH_AUTH_SOCK = originalEnv;
        });
    });
    (0, vitest_1.describe)('authentication error handling', () => {
        (0, vitest_1.it)('should throw error when agent socket is not set', async () => {
            const originalEnv = process.env.SSH_AUTH_SOCK;
            delete process.env.SSH_AUTH_SOCK;
            const config = {
                id: 'conn-5',
                name: 'Agent Connection',
                host: 'example.com',
                port: 22,
                username: 'testuser',
                authType: 'agent',
            };
            // Suppress error event
            service.on('error', () => { });
            await (0, vitest_1.expect)(service.connect(config)).rejects.toThrow(/SSH agent authentication failed/);
            process.env.SSH_AUTH_SOCK = originalEnv;
        });
        (0, vitest_1.it)('should throw error when password is not found', async () => {
            const config = {
                id: 'conn-6',
                name: 'Password Connection',
                host: 'example.com',
                port: 22,
                username: 'testuser',
                authType: 'password',
            };
            mockCredentialService.getPassword.mockResolvedValue(null);
            service.on('error', () => { });
            await (0, vitest_1.expect)(service.connect(config)).rejects.toThrow('No password found for connection conn-6');
        });
        (0, vitest_1.it)('should throw error when private key path is missing', async () => {
            const config = {
                id: 'conn-7',
                name: 'Key Connection',
                host: 'example.com',
                port: 22,
                username: 'testuser',
                authType: 'key',
            };
            service.on('error', () => { });
            await (0, vitest_1.expect)(service.connect(config)).rejects.toThrow('Private key path is required for key authentication');
        });
        (0, vitest_1.it)('should throw error when private key file cannot be read', async () => {
            const { readFile } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            readFile.mockRejectedValue(new Error('Permission denied'));
            const config = {
                id: 'conn-8',
                name: 'Key Connection',
                host: 'example.com',
                port: 22,
                username: 'testuser',
                authType: 'key',
                privateKeyPath: '/home/user/.ssh/id_rsa',
            };
            service.on('error', () => { });
            await (0, vitest_1.expect)(service.connect(config)).rejects.toThrow('Failed to read private key: Permission denied');
        });
    });
    (0, vitest_1.describe)('connection management', () => {
        (0, vitest_1.it)('should generate UUID when id is not provided', async () => {
            const config = {
                name: 'Test Connection',
                host: 'example.com',
                port: 22,
                username: 'testuser',
                authType: 'password',
            };
            mockCredentialService.getPassword.mockResolvedValue('testpassword');
            mockClientInstance.connect.mockImplementation((cfg) => {
                const readyHandler = mockClientInstance.on.mock.calls.find((call) => call[0] === 'ready')?.[1];
                if (readyHandler) {
                    setTimeout(() => readyHandler(), 0);
                }
            });
            const connectionId = await service.connect(config);
            (0, vitest_1.expect)(connectionId).toBe('test-uuid-123');
        });
        (0, vitest_1.it)('should track connection state', async () => {
            const config = {
                id: 'conn-9',
                name: 'Test Connection',
                host: 'example.com',
                port: 22,
                username: 'testuser',
                authType: 'password',
            };
            mockCredentialService.getPassword.mockResolvedValue('testpassword');
            mockClientInstance.connect.mockImplementation((cfg) => {
                const readyHandler = mockClientInstance.on.mock.calls.find((call) => call[0] === 'ready')?.[1];
                if (readyHandler) {
                    setTimeout(() => readyHandler(), 0);
                }
            });
            (0, vitest_1.expect)(service.isConnected('conn-9')).toBe(false);
            await service.connect(config);
            (0, vitest_1.expect)(service.isConnected('conn-9')).toBe(true);
        });
        (0, vitest_1.it)('should list connections', async () => {
            const config1 = {
                id: 'conn-a',
                name: 'Connection A',
                host: 'host-a.com',
                port: 22,
                username: 'user-a',
                authType: 'password',
            };
            const config2 = {
                id: 'conn-b',
                name: 'Connection B',
                host: 'host-b.com',
                port: 22,
                username: 'user-b',
                authType: 'password',
            };
            mockCredentialService.getPassword.mockResolvedValue('testpassword');
            // Setup mock to capture and trigger ready handlers
            const readyHandlers = [];
            mockClientInstance.on.mockImplementation((event, handler) => {
                if (event === 'ready') {
                    readyHandlers.push(handler);
                }
                return mockClientInstance;
            });
            mockClientInstance.connect.mockImplementation(() => {
                // Trigger the last registered ready handler
                const handler = readyHandlers[readyHandlers.length - 1];
                if (handler) {
                    setTimeout(() => handler(), 0);
                }
            });
            await service.connect(config1);
            await service.connect(config2);
            const connections = service.listConnections();
            (0, vitest_1.expect)(connections).toContain('conn-a');
            (0, vitest_1.expect)(connections).toContain('conn-b');
        });
        (0, vitest_1.it)('should get connection info', async () => {
            const config = {
                id: 'conn-20',
                name: 'Test Connection',
                host: 'example.com',
                port: 22,
                username: 'testuser',
                authType: 'password',
            };
            mockCredentialService.getPassword.mockResolvedValue('testpassword');
            mockClientInstance.connect.mockImplementation((cfg) => {
                const readyHandler = mockClientInstance.on.mock.calls.find((call) => call[0] === 'ready')?.[1];
                if (readyHandler) {
                    setTimeout(() => readyHandler(), 0);
                }
            });
            await service.connect(config);
            const info = service.getConnectionInfo('conn-20');
            (0, vitest_1.expect)(info).not.toBeNull();
            (0, vitest_1.expect)(info?.connectedAt).toBeInstanceOf(Date);
            (0, vitest_1.expect)(info?.lastActivity).toBeInstanceOf(Date);
        });
        (0, vitest_1.it)('should return null for non-existent connection info', async () => {
            const info = service.getConnectionInfo('non-existent');
            (0, vitest_1.expect)(info).toBeNull();
        });
        (0, vitest_1.it)('should get all connections', async () => {
            const config = {
                id: 'conn-21',
                name: 'Test Connection',
                host: 'example.com',
                port: 22,
                username: 'testuser',
                authType: 'password',
            };
            mockCredentialService.getPassword.mockResolvedValue('testpassword');
            mockClientInstance.connect.mockImplementation((cfg) => {
                const readyHandler = mockClientInstance.on.mock.calls.find((call) => call[0] === 'ready')?.[1];
                if (readyHandler) {
                    setTimeout(() => readyHandler(), 0);
                }
            });
            await service.connect(config);
            const connections = service.getAllConnections();
            (0, vitest_1.expect)(connections).toHaveLength(1);
            (0, vitest_1.expect)(connections[0].id).toBe('conn-21');
        });
        (0, vitest_1.it)('should handle disconnect for non-existent connection', async () => {
            await service.disconnect('non-existent');
            (0, vitest_1.expect)(mockClientInstance.end).not.toHaveBeenCalled();
        });
    });
    (0, vitest_1.describe)('GSSAPI/Kerberos authentication', () => {
        /**
         * Helper: sets up mockSpawn to return a process that auto-triggers 'close'
         * with the given exit code via queueMicrotask, after all handlers are registered.
         */
        function setupGssapiSpawn(exitCode, stderrOutput) {
            mockSpawn.mockImplementation(() => {
                const stderrHandlers = {};
                const mockProc = {
                    on: vitest_1.vi.fn((event, handler) => {
                        if (event === 'close') {
                            // Fire close asynchronously so all handlers are registered first
                            queueMicrotask(() => {
                                if (stderrOutput && stderrHandlers['data']) {
                                    stderrHandlers['data'](Buffer.from(stderrOutput));
                                }
                                handler(exitCode);
                            });
                        }
                    }),
                    stderr: {
                        on: vitest_1.vi.fn((event, handler) => {
                            stderrHandlers[event] = handler;
                        }),
                    },
                    stdout: { on: vitest_1.vi.fn() },
                    stdin: { on: vitest_1.vi.fn() },
                    killed: false,
                    kill: vitest_1.vi.fn(),
                };
                return mockProc;
            });
        }
        (0, vitest_1.it)('should establish a GSSAPI connection via ControlMaster', async () => {
            const config = {
                id: 'conn-gssapi-1',
                name: 'GSSAPI Connection',
                host: 'krb.example.com',
                port: 22,
                username: 'krbuser',
                authType: 'gssapi',
            };
            setupGssapiSpawn(0);
            const connectionId = await service.connect(config);
            (0, vitest_1.expect)(connectionId).toBe('conn-gssapi-1');
            (0, vitest_1.expect)(service.isConnected('conn-gssapi-1')).toBe(true);
            (0, vitest_1.expect)(service.isGssapiConnection('conn-gssapi-1')).toBe(true);
            // Verify spawn was called with GSSAPI flags
            (0, vitest_1.expect)(mockSpawn).toHaveBeenCalledWith('ssh', vitest_1.expect.arrayContaining([
                '-f',
                '-N',
                '-M',
                '-o',
                'GSSAPIAuthentication=yes',
                '-l',
                'krbuser',
                'krb.example.com',
            ]), vitest_1.expect.any(Object));
        });
        (0, vitest_1.it)('should reject when GSSAPI authentication fails', async () => {
            const config = {
                id: 'conn-gssapi-fail',
                name: 'GSSAPI Fail',
                host: 'krb.example.com',
                port: 22,
                username: 'krbuser',
                authType: 'gssapi',
            };
            setupGssapiSpawn(255, 'Permission denied');
            service.on('error', () => { });
            await (0, vitest_1.expect)(service.connect(config)).rejects.toThrow('Permission denied');
        });
        (0, vitest_1.it)('should throw SFTP error for GSSAPI connections', async () => {
            const config = {
                id: 'conn-gssapi-sftp',
                name: 'GSSAPI SFTP',
                host: 'krb.example.com',
                port: 22,
                username: 'krbuser',
                authType: 'gssapi',
            };
            setupGssapiSpawn(0);
            await service.connect(config);
            await (0, vitest_1.expect)(service.getSftp('conn-gssapi-sftp')).rejects.toThrow('SFTP is not available for GSSAPI connections');
        });
        (0, vitest_1.it)('should execute commands via system ssh for GSSAPI connections', async () => {
            const config = {
                id: 'conn-gssapi-exec',
                name: 'GSSAPI Exec',
                host: 'krb.example.com',
                port: 22,
                username: 'krbuser',
                authType: 'gssapi',
            };
            setupGssapiSpawn(0);
            await service.connect(config);
            // Mock execFile for command execution
            mockExecFile.mockImplementation((cmd, args, opts, callback) => {
                callback(null, 'hello world\n', '');
            });
            const result = await service.executeCommand('conn-gssapi-exec', 'echo hello world');
            (0, vitest_1.expect)(result.stdout).toBe('hello world');
            (0, vitest_1.expect)(result.exitCode).toBe(0);
            (0, vitest_1.expect)(mockExecFile).toHaveBeenCalledWith('ssh', vitest_1.expect.arrayContaining(['-o', 'ControlMaster=no', 'krb.example.com']), vitest_1.expect.any(Object), vitest_1.expect.any(Function));
        });
        (0, vitest_1.it)('should return GSSAPI connection info', async () => {
            const config = {
                id: 'conn-gssapi-info',
                name: 'GSSAPI Info',
                host: 'krb.example.com',
                port: 22,
                username: 'krbuser',
                authType: 'gssapi',
            };
            setupGssapiSpawn(0);
            await service.connect(config);
            const info = service.getConnectionInfo('conn-gssapi-info');
            (0, vitest_1.expect)(info).not.toBeNull();
            (0, vitest_1.expect)(info?.connectedAt).toBeInstanceOf(Date);
            const connections = service.listConnections();
            (0, vitest_1.expect)(connections).toContain('conn-gssapi-info');
        });
    });
    (0, vitest_1.describe)('escapeShellArg', () => {
        (0, vitest_1.it)('should escape single quotes in shell arguments', async () => {
            const config = {
                id: 'conn-esc',
                name: 'Test',
                host: 'example.com',
                port: 22,
                username: 'user',
                authType: 'password',
            };
            mockCredentialService.getPassword.mockResolvedValue('password');
            // Use exec to test escapeShellArg indirectly
            const { EventEmitter } = await Promise.resolve().then(() => __importStar(require('events')));
            const mockStream = new EventEmitter();
            mockStream.stderr = new EventEmitter();
            mockClientInstance.connect.mockImplementation((cfg) => {
                const readyHandler = mockClientInstance.on.mock.calls.find((call) => call[0] === 'ready')?.[1];
                if (readyHandler) {
                    setTimeout(() => readyHandler(), 0);
                }
            });
            mockClientInstance.exec.mockImplementation((command, callback) => {
                callback(null, mockStream);
                setTimeout(() => {
                    mockStream.emit('close', 0);
                }, 0);
            });
            await service.connect(config);
            await service.executeCommand('conn-esc', 'ls', "/path/with'quotes");
            // Verify the command was escaped
            const execCall = mockClientInstance.exec.mock.calls[0];
            (0, vitest_1.expect)(execCall[0]).toContain("'");
            (0, vitest_1.expect)(execCall[0]).toContain("'\\''");
        });
    });
});
