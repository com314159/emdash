"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const crypto_1 = require("crypto");
const SshHostKeyService_1 = require("../SshHostKeyService");
// Mock fs/promises with hoisting-safe pattern
vitest_1.vi.mock('fs/promises', () => {
    return {
        readFile: vitest_1.vi.fn(),
        writeFile: vitest_1.vi.fn(),
        appendFile: vitest_1.vi.fn(),
        access: vitest_1.vi.fn(),
    };
});
// Mock os
vitest_1.vi.mock('os', () => ({
    homedir: vitest_1.vi.fn().mockReturnValue('/home/testuser'),
}));
// Import after mocking
const promises_1 = require("fs/promises");
(0, vitest_1.describe)('SshHostKeyService', () => {
    let service;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        service = new SshHostKeyService_1.SshHostKeyService();
    });
    (0, vitest_1.describe)('initialization', () => {
        (0, vitest_1.it)('should initialize with empty known_hosts if file does not exist', async () => {
            promises_1.access.mockRejectedValue(new Error('File not found'));
            await service.initialize();
            const hosts = await service.getKnownHosts();
            (0, vitest_1.expect)(hosts).toEqual([]);
            (0, vitest_1.expect)(promises_1.access).toHaveBeenCalledWith('/home/testuser/.ssh/known_hosts');
        });
        (0, vitest_1.it)('should parse existing known_hosts file', async () => {
            const knownHostsContent = `
# This is a comment
host1.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDIhz2GK/XCUj4i6Q5yQJNL1MXMY0RxzPV2QrBqfHrDq
[host2.example.com]:2222 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCx

host3.example.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBM1
      `;
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue(knownHostsContent);
            await service.initialize();
            const hosts = await service.getKnownHosts();
            (0, vitest_1.expect)(hosts).toHaveLength(3);
            (0, vitest_1.expect)(hosts.some((h) => h.host === 'host1.example.com')).toBe(true);
            (0, vitest_1.expect)(hosts.some((h) => h.host === 'host2.example.com' && h.port === 2222)).toBe(true);
        });
        (0, vitest_1.it)('should skip re-initialization', async () => {
            promises_1.access.mockRejectedValue(new Error('File not found'));
            await service.initialize();
            await service.initialize();
            (0, vitest_1.expect)(promises_1.access).toHaveBeenCalledTimes(1);
        });
    });
    (0, vitest_1.describe)('fingerprint generation', () => {
        (0, vitest_1.it)('should generate SHA256 fingerprint', () => {
            const keyBuffer = Buffer.from('test-key-data');
            const fingerprint = service.getFingerprint(keyBuffer);
            const expectedHash = (0, crypto_1.createHash)('sha256').update(keyBuffer).digest('base64');
            (0, vitest_1.expect)(fingerprint).toBe(`SHA256:${expectedHash}`);
        });
        (0, vitest_1.it)('should generate different fingerprints for different keys', () => {
            const key1 = Buffer.from('key-one');
            const key2 = Buffer.from('key-two');
            const fp1 = service.getFingerprint(key1);
            const fp2 = service.getFingerprint(key2);
            (0, vitest_1.expect)(fp1).not.toBe(fp2);
        });
        (0, vitest_1.it)('should generate consistent fingerprints for same key', () => {
            const key = Buffer.from('test-key');
            const fp1 = service.getFingerprint(key);
            const fp2 = service.getFingerprint(key);
            (0, vitest_1.expect)(fp1).toBe(fp2);
        });
    });
    (0, vitest_1.describe)('host key verification', () => {
        (0, vitest_1.it)('should return new for unknown host', async () => {
            promises_1.access.mockRejectedValue(new Error('File not found'));
            const result = await service.verifyHostKey('unknown.host.com', 22, 'ssh-ed25519', 'SHA256:abc123');
            (0, vitest_1.expect)(result).toBe('new');
        });
        (0, vitest_1.it)('should return known for matching fingerprint', async () => {
            const keyBuffer = Buffer.from('known-key-data');
            const fingerprint = service.getFingerprint(keyBuffer);
            const keyBase64 = keyBuffer.toString('base64');
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue(`known.host.com ssh-ed25519 ${keyBase64}`);
            const result = await service.verifyHostKey('known.host.com', 22, 'ssh-ed25519', fingerprint);
            (0, vitest_1.expect)(result).toBe('known');
        });
        (0, vitest_1.it)('should return changed for non-matching fingerprint', async () => {
            const keyBuffer = Buffer.from('original-key-data');
            const keyBase64 = keyBuffer.toString('base64');
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue(`changed.host.com ssh-ed25519 ${keyBase64}`);
            const result = await service.verifyHostKey('changed.host.com', 22, 'ssh-ed25519', 'SHA256:differentfingerprint');
            (0, vitest_1.expect)(result).toBe('changed');
        });
        (0, vitest_1.it)('should handle non-standard port format', async () => {
            const keyBuffer = Buffer.from('port-key-data');
            const fingerprint = service.getFingerprint(keyBuffer);
            const keyBase64 = keyBuffer.toString('base64');
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue(`[port.host.com]:2222 ssh-ed25519 ${keyBase64}`);
            const result = await service.verifyHostKey('port.host.com', 2222, 'ssh-ed25519', fingerprint);
            (0, vitest_1.expect)(result).toBe('known');
        });
    });
    (0, vitest_1.describe)('verifyHostKeyBuffer', () => {
        (0, vitest_1.it)('should return unknown for unknown host', async () => {
            promises_1.access.mockRejectedValue(new Error('File not found'));
            const keyBuffer = Buffer.from('new-key');
            const result = await service.verifyHostKeyBuffer('unknown.host.com', 22, keyBuffer);
            (0, vitest_1.expect)(result).toBe('unknown');
        });
        (0, vitest_1.it)('should return valid for matching key buffer', async () => {
            const keyBuffer = Buffer.from('matching-key-data');
            const keyBase64 = keyBuffer.toString('base64');
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue(`valid.host.com ssh-ed25519 ${keyBase64}`);
            const result = await service.verifyHostKeyBuffer('valid.host.com', 22, keyBuffer);
            (0, vitest_1.expect)(result).toBe('valid');
        });
        (0, vitest_1.it)('should return invalid for non-matching key buffer', async () => {
            const originalKey = Buffer.from('original-key').toString('base64');
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue(`invalid.host.com ssh-ed25519 ${originalKey}`);
            const differentKey = Buffer.from('different-key');
            const result = await service.verifyHostKeyBuffer('invalid.host.com', 22, differentKey);
            (0, vitest_1.expect)(result).toBe('invalid');
        });
    });
    (0, vitest_1.describe)('addHostKey', () => {
        (0, vitest_1.it)('should add host key with standard port', async () => {
            promises_1.access.mockRejectedValue(new Error('File not found'));
            await service.addHostKey('new.host.com', 22, 'ssh-ed25519', 'SHA256:abc123def456');
            (0, vitest_1.expect)(promises_1.writeFile).toHaveBeenCalledWith('/home/testuser/.ssh/known_hosts', 'new.host.com ssh-ed25519 SHA256:abc123def456\n');
        });
        (0, vitest_1.it)('should add host key with non-standard port', async () => {
            promises_1.access.mockRejectedValue(new Error('File not found'));
            await service.addHostKey('new.host.com', 2222, 'ssh-ed25519', 'SHA256:abc123def456');
            (0, vitest_1.expect)(promises_1.writeFile).toHaveBeenCalledWith('/home/testuser/.ssh/known_hosts', '[new.host.com]:2222 ssh-ed25519 SHA256:abc123def456\n');
        });
        (0, vitest_1.it)('should update existing host key', async () => {
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue('old.host.com ssh-ed25519 oldkey\n');
            await service.addHostKey('old.host.com', 22, 'ssh-ed25519', 'new-fingerprint');
            (0, vitest_1.expect)(promises_1.writeFile).toHaveBeenCalledWith('/home/testuser/.ssh/known_hosts', 'old.host.com ssh-ed25519 new-fingerprint\n');
        });
    });
    (0, vitest_1.describe)('addKnownHost', () => {
        (0, vitest_1.it)('should append host with raw key buffer', async () => {
            promises_1.access.mockRejectedValue(new Error('File not found'));
            const keyBuffer = Buffer.from('raw-key-data');
            await service.addKnownHost('raw.host.com', 22, keyBuffer, 'ssh-ed25519');
            const expectedEntry = 'raw.host.com ssh-ed25519 cmF3LWtleS1kYXRh\n';
            (0, vitest_1.expect)(promises_1.appendFile).toHaveBeenCalledWith('/home/testuser/.ssh/known_hosts', expectedEntry);
        });
        (0, vitest_1.it)('should use default algorithm when not specified', async () => {
            promises_1.access.mockRejectedValue(new Error('File not found'));
            const keyBuffer = Buffer.from('key-data');
            await service.addKnownHost('default.algo.com', 22, keyBuffer);
            (0, vitest_1.expect)(promises_1.appendFile).toHaveBeenCalledWith('/home/testuser/.ssh/known_hosts', vitest_1.expect.stringContaining('ssh-ed25519'));
        });
        (0, vitest_1.it)('should throw error when append fails', async () => {
            promises_1.access.mockRejectedValue(new Error('File not found'));
            promises_1.appendFile.mockRejectedValue(new Error('Permission denied'));
            const keyBuffer = Buffer.from('key-data');
            await (0, vitest_1.expect)(service.addKnownHost('fail.host.com', 22, keyBuffer)).rejects.toThrow('Failed to write to known_hosts');
        });
    });
    (0, vitest_1.describe)('removeHostKey', () => {
        (0, vitest_1.it)('should remove host with standard port', async () => {
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue(`remove.host.com ssh-ed25519 key1\nother.host.com ssh-ed25519 key2\n`);
            await service.removeHostKey('remove.host.com', 22);
            (0, vitest_1.expect)(promises_1.writeFile).toHaveBeenCalledWith('/home/testuser/.ssh/known_hosts', 'other.host.com ssh-ed25519 key2\n');
        });
        (0, vitest_1.it)('should remove host with non-standard port', async () => {
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue(`[remove.host.com]:2222 ssh-ed25519 key1\nother.host.com ssh-ed25519 key2\n`);
            await service.removeHostKey('remove.host.com', 2222);
            (0, vitest_1.expect)(promises_1.writeFile).toHaveBeenCalledWith('/home/testuser/.ssh/known_hosts', 'other.host.com ssh-ed25519 key2\n');
        });
        (0, vitest_1.it)('should remove both host and host:port entries', async () => {
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue(`remove.host.com ssh-ed25519 key1\n[remove.host.com]:2222 ssh-ed25519 key2\n`);
            await service.removeHostKey('remove.host.com', 2222);
            const writeCall = promises_1.writeFile.mock.calls[0];
            (0, vitest_1.expect)(writeCall[1]).not.toContain('remove.host.com');
        });
    });
    (0, vitest_1.describe)('removeKnownHost', () => {
        (0, vitest_1.it)('should be alias for removeHostKey', async () => {
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue('alias.host.com ssh-ed25519 key\n');
            await service.removeKnownHost('alias.host.com', 22);
            (0, vitest_1.expect)(promises_1.writeFile).toHaveBeenCalled();
        });
    });
    (0, vitest_1.describe)('getKnownHosts', () => {
        (0, vitest_1.it)('should return all known hosts with metadata', async () => {
            const keyBuffer = Buffer.from('test-key-data');
            const keyBase64 = keyBuffer.toString('base64');
            const expectedFingerprint = service.getFingerprint(keyBuffer);
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue(`host1.example.com ssh-ed25519 ${keyBase64}\n[host2.example.com]:2222 ssh-rsa ${keyBase64}`);
            const hosts = await service.getKnownHosts();
            (0, vitest_1.expect)(hosts).toHaveLength(2);
            (0, vitest_1.expect)(hosts[0]).toMatchObject({
                host: 'host1.example.com',
                port: 22,
                keyType: 'ssh-ed25519',
                fingerprint: expectedFingerprint,
            });
            (0, vitest_1.expect)(hosts[0].verifiedAt).toBeInstanceOf(Date);
        });
        (0, vitest_1.it)('should parse host:port format correctly', async () => {
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue('[complex.host.com]:2222 ssh-ed25519 keydata');
            const hosts = await service.getKnownHosts();
            (0, vitest_1.expect)(hosts[0]).toMatchObject({
                host: 'complex.host.com',
                port: 2222,
            });
        });
    });
    (0, vitest_1.describe)('isHostKnown', () => {
        (0, vitest_1.it)('should return true for known host', async () => {
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue('known.host.com ssh-ed25519 key\n');
            const result = await service.isHostKnown('known.host.com', 22);
            (0, vitest_1.expect)(result).toBe(true);
        });
        (0, vitest_1.it)('should return false for unknown host', async () => {
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue('known.host.com ssh-ed25519 key\n');
            const result = await service.isHostKnown('unknown.host.com', 22);
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should check both host and host:port formats', async () => {
            promises_1.access.mockResolvedValue(undefined);
            promises_1.readFile.mockResolvedValue('[port.host.com]:2222 ssh-ed25519 key\n');
            (0, vitest_1.expect)(await service.isHostKnown('port.host.com', 2222)).toBe(true);
            (0, vitest_1.expect)(await service.isHostKnown('port.host.com', 22)).toBe(false);
        });
    });
    (0, vitest_1.describe)('getHostKeyInfo', () => {
        (0, vitest_1.it)('should return host key info object', () => {
            const keyBuffer = Buffer.from('test-key-data');
            const info = service.getHostKeyInfo('info.host.com', 22, keyBuffer, 'ssh-ed25519');
            (0, vitest_1.expect)(info).toMatchObject({
                host: 'info.host.com',
                port: 22,
                algorithm: 'ssh-ed25519',
                key: keyBuffer,
            });
            (0, vitest_1.expect)(info.fingerprint).toMatch(/^SHA256:/);
        });
    });
});
