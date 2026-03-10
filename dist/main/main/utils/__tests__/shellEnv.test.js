"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const shellEnv_1 = require("../shellEnv");
// Mock child_process
vitest_1.vi.mock('child_process', () => ({
    execSync: vitest_1.vi.fn(),
}));
// Mock fs
vitest_1.vi.mock('fs', () => ({
    statSync: vitest_1.vi.fn(),
    readdirSync: vitest_1.vi.fn(),
}));
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const mockedExecSync = vitest_1.vi.mocked(child_process_1.execSync);
const mockedStatSync = vitest_1.vi.mocked(fs_1.statSync);
const mockedReaddirSync = vitest_1.vi.mocked(fs_1.readdirSync);
(0, vitest_1.describe)('shellEnv', () => {
    const originalEnv = process.env;
    (0, vitest_1.beforeEach)(() => {
        // Reset process.env
        process.env = { ...originalEnv };
        vitest_1.vi.resetAllMocks();
    });
    (0, vitest_1.afterEach)(() => {
        process.env = originalEnv;
    });
    (0, vitest_1.describe)('getShellEnvVar', () => {
        (0, vitest_1.it)('should return environment variable from shell', () => {
            mockedExecSync.mockReturnValue('/path/to/socket');
            const result = (0, shellEnv_1.getShellEnvVar)('SSH_AUTH_SOCK');
            (0, vitest_1.expect)(result).toBe('/path/to/socket');
            (0, vitest_1.expect)(mockedExecSync).toHaveBeenCalledWith(vitest_1.expect.stringContaining('printenv SSH_AUTH_SOCK'), vitest_1.expect.objectContaining({ encoding: 'utf8', timeout: 5000 }));
        });
        (0, vitest_1.it)('should return undefined when variable is empty', () => {
            mockedExecSync.mockReturnValue('');
            const result = (0, shellEnv_1.getShellEnvVar)('SSH_AUTH_SOCK');
            (0, vitest_1.expect)(result).toBeUndefined();
        });
        (0, vitest_1.it)('should return undefined when shell command fails', () => {
            mockedExecSync.mockImplementation(() => {
                throw new Error('Command failed');
            });
            const result = (0, shellEnv_1.getShellEnvVar)('SSH_AUTH_SOCK');
            (0, vitest_1.expect)(result).toBeUndefined();
        });
    });
    (0, vitest_1.describe)('detectSshAuthSock', () => {
        (0, vitest_1.it)('should return existing SSH_AUTH_SOCK if already set', () => {
            process.env.SSH_AUTH_SOCK = '/existing/socket';
            // On macOS, launchctl is tried first but may fail
            mockedExecSync.mockImplementation(() => {
                throw new Error('launchctl failed');
            });
            const result = (0, shellEnv_1.detectSshAuthSock)();
            (0, vitest_1.expect)(result).toBe('/existing/socket');
        });
        (0, vitest_1.it)('should detect SSH_AUTH_SOCK when not in process.env', () => {
            delete process.env.SSH_AUTH_SOCK;
            mockedExecSync.mockReturnValue('/shell/detected/socket');
            const result = (0, shellEnv_1.detectSshAuthSock)();
            (0, vitest_1.expect)(result).toBe('/shell/detected/socket');
        });
        (0, vitest_1.it)('should check common locations as fallback', () => {
            delete process.env.SSH_AUTH_SOCK;
            mockedExecSync.mockImplementation(() => {
                throw new Error('Shell detection failed');
            });
            // Mock readdirSync to simulate finding a socket
            mockedReaddirSync.mockImplementation((dirPath) => {
                const pathStr = dirPath.toString();
                if (pathStr.includes('com.apple.launchd')) {
                    return ['Listeners'];
                }
                return [];
            });
            // Mock statSync to indicate it's a socket
            mockedStatSync.mockReturnValue({ isSocket: () => true });
            const result = (0, shellEnv_1.detectSshAuthSock)();
            // Should find the socket in launchd directory
            (0, vitest_1.expect)(result).toBeTruthy();
        });
        vitest_1.it.skipIf(process.platform !== 'darwin')('should prefer launchctl value over process.env on macOS', () => {
            process.env.SSH_AUTH_SOCK = '/private/tmp/com.apple.launchd.XXX/Listeners';
            mockedExecSync.mockReturnValue('/Users/test/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock\n');
            const result = (0, shellEnv_1.detectSshAuthSock)();
            (0, vitest_1.expect)(result).toBe('/Users/test/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock');
        });
        (0, vitest_1.it)('should return undefined when no socket is found', () => {
            delete process.env.SSH_AUTH_SOCK;
            mockedExecSync.mockImplementation(() => {
                throw new Error('Shell detection failed');
            });
            mockedReaddirSync.mockImplementation(() => []);
            const result = (0, shellEnv_1.detectSshAuthSock)();
            (0, vitest_1.expect)(result).toBeUndefined();
        });
    });
    (0, vitest_1.describe)('initializeShellEnvironment', () => {
        (0, vitest_1.it)('should set process.env.SSH_AUTH_SOCK when socket is detected', () => {
            delete process.env.SSH_AUTH_SOCK;
            mockedExecSync.mockReturnValue('/detected/socket');
            (0, shellEnv_1.initializeShellEnvironment)();
            (0, vitest_1.expect)(process.env.SSH_AUTH_SOCK).toBe('/detected/socket');
        });
        (0, vitest_1.it)('should fall back to existing SSH_AUTH_SOCK when launchctl fails', () => {
            process.env.SSH_AUTH_SOCK = '/existing/socket';
            // On macOS, launchctl is tried first but may fail
            mockedExecSync.mockImplementation(() => {
                throw new Error('launchctl failed');
            });
            (0, shellEnv_1.initializeShellEnvironment)();
            (0, vitest_1.expect)(process.env.SSH_AUTH_SOCK).toBe('/existing/socket');
        });
    });
});
