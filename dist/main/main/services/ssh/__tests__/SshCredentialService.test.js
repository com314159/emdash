"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const SshCredentialService_1 = require("../SshCredentialService");
// Mock keytar with hoisting-safe pattern
const mockSetPassword = vitest_1.vi.fn().mockResolvedValue(undefined);
const mockGetPassword = vitest_1.vi.fn().mockResolvedValue(null);
const mockDeletePassword = vitest_1.vi.fn().mockResolvedValue(undefined);
vitest_1.vi.mock('keytar', () => {
    return {
        setPassword: (...args) => mockSetPassword(...args),
        getPassword: (...args) => mockGetPassword(...args),
        deletePassword: (...args) => mockDeletePassword(...args),
        default: {
            setPassword: (...args) => mockSetPassword(...args),
            getPassword: (...args) => mockGetPassword(...args),
            deletePassword: (...args) => mockDeletePassword(...args),
        },
    };
});
(0, vitest_1.describe)('SshCredentialService', () => {
    let service;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        // Reset default mock implementations
        mockSetPassword.mockResolvedValue(undefined);
        mockGetPassword.mockResolvedValue(null);
        mockDeletePassword.mockResolvedValue(undefined);
        service = new SshCredentialService_1.SshCredentialService();
    });
    (0, vitest_1.describe)('password operations', () => {
        (0, vitest_1.it)('should store password in keychain', async () => {
            await service.storePassword('conn-1', 'secretpassword');
            (0, vitest_1.expect)(mockSetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:password', 'secretpassword');
        });
        (0, vitest_1.it)('should retrieve password from keychain', async () => {
            mockGetPassword.mockResolvedValue('secretpassword');
            const result = await service.getPassword('conn-1');
            (0, vitest_1.expect)(mockGetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:password');
            (0, vitest_1.expect)(result).toBe('secretpassword');
        });
        (0, vitest_1.it)('should return null when password not found', async () => {
            mockGetPassword.mockResolvedValue(null);
            const result = await service.getPassword('conn-1');
            (0, vitest_1.expect)(result).toBeNull();
        });
        (0, vitest_1.it)('should delete password from keychain', async () => {
            await service.deletePassword('conn-1');
            (0, vitest_1.expect)(mockDeletePassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:password');
        });
        (0, vitest_1.it)('should check if password exists', async () => {
            mockGetPassword.mockResolvedValue('secretpassword');
            const result = await service.hasPassword('conn-1');
            (0, vitest_1.expect)(result).toBe(true);
            (0, vitest_1.expect)(mockGetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:password');
        });
        (0, vitest_1.it)('should return false when password does not exist', async () => {
            mockGetPassword.mockResolvedValue(null);
            const result = await service.hasPassword('conn-1');
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should throw error when store password fails', async () => {
            mockSetPassword.mockRejectedValue(new Error('Keychain locked'));
            await (0, vitest_1.expect)(service.storePassword('conn-1', 'password')).rejects.toThrow('Failed to store password for connection conn-1: Keychain locked');
        });
        (0, vitest_1.it)('should throw error when get password fails', async () => {
            mockGetPassword.mockRejectedValue(new Error('Access denied'));
            await (0, vitest_1.expect)(service.getPassword('conn-1')).rejects.toThrow('Failed to retrieve password for connection conn-1: Access denied');
        });
        (0, vitest_1.it)('should throw error when delete password fails', async () => {
            mockDeletePassword.mockRejectedValue(new Error('Keychain error'));
            await (0, vitest_1.expect)(service.deletePassword('conn-1')).rejects.toThrow('Failed to delete password for connection conn-1: Keychain error');
        });
        (0, vitest_1.it)('should return false for hasPassword when keytar throws', async () => {
            mockGetPassword.mockRejectedValue(new Error('Keychain error'));
            const result = await service.hasPassword('conn-1');
            (0, vitest_1.expect)(result).toBe(false);
        });
    });
    (0, vitest_1.describe)('passphrase operations', () => {
        (0, vitest_1.it)('should store passphrase in keychain', async () => {
            mockSetPassword.mockResolvedValue(undefined);
            await service.storePassphrase('conn-1', 'my-passphrase');
            (0, vitest_1.expect)(mockSetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:passphrase', 'my-passphrase');
        });
        (0, vitest_1.it)('should retrieve passphrase from keychain', async () => {
            mockGetPassword.mockResolvedValue('my-passphrase');
            const result = await service.getPassphrase('conn-1');
            (0, vitest_1.expect)(mockGetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:passphrase');
            (0, vitest_1.expect)(result).toBe('my-passphrase');
        });
        (0, vitest_1.it)('should return null when passphrase not found', async () => {
            mockGetPassword.mockResolvedValue(null);
            const result = await service.getPassphrase('conn-1');
            (0, vitest_1.expect)(result).toBeNull();
        });
        (0, vitest_1.it)('should delete passphrase from keychain', async () => {
            mockDeletePassword.mockResolvedValue(undefined);
            await service.deletePassphrase('conn-1');
            (0, vitest_1.expect)(mockDeletePassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:passphrase');
        });
        (0, vitest_1.it)('should check if passphrase exists', async () => {
            mockGetPassword.mockResolvedValue('my-passphrase');
            const result = await service.hasPassphrase('conn-1');
            (0, vitest_1.expect)(result).toBe(true);
            (0, vitest_1.expect)(mockGetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:passphrase');
        });
        (0, vitest_1.it)('should return false when passphrase does not exist', async () => {
            mockGetPassword.mockResolvedValue(null);
            const result = await service.hasPassphrase('conn-1');
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should throw error when store passphrase fails', async () => {
            mockSetPassword.mockRejectedValue(new Error('Keychain locked'));
            await (0, vitest_1.expect)(service.storePassphrase('conn-1', 'passphrase')).rejects.toThrow('Failed to store passphrase for connection conn-1: Keychain locked');
        });
        (0, vitest_1.it)('should throw error when get passphrase fails', async () => {
            mockGetPassword.mockRejectedValue(new Error('Access denied'));
            await (0, vitest_1.expect)(service.getPassphrase('conn-1')).rejects.toThrow('Failed to retrieve passphrase for connection conn-1: Access denied');
        });
        (0, vitest_1.it)('should throw error when delete passphrase fails', async () => {
            mockDeletePassword.mockRejectedValue(new Error('Keychain error'));
            await (0, vitest_1.expect)(service.deletePassphrase('conn-1')).rejects.toThrow('Failed to delete passphrase for connection conn-1: Keychain error');
        });
        (0, vitest_1.it)('should return false for hasPassphrase when keytar throws', async () => {
            mockGetPassword.mockRejectedValue(new Error('Keychain error'));
            const result = await service.hasPassphrase('conn-1');
            (0, vitest_1.expect)(result).toBe(false);
        });
    });
    (0, vitest_1.describe)('bulk operations', () => {
        (0, vitest_1.it)('should store both password and passphrase', async () => {
            mockSetPassword.mockResolvedValue(undefined);
            await service.storeCredentials('conn-1', {
                password: 'secretpassword',
                passphrase: 'my-passphrase',
            });
            (0, vitest_1.expect)(mockSetPassword).toHaveBeenCalledTimes(2);
            (0, vitest_1.expect)(mockSetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:password', 'secretpassword');
            (0, vitest_1.expect)(mockSetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:passphrase', 'my-passphrase');
        });
        (0, vitest_1.it)('should store only password when passphrase not provided', async () => {
            mockSetPassword.mockResolvedValue(undefined);
            await service.storeCredentials('conn-1', {
                password: 'secretpassword',
            });
            (0, vitest_1.expect)(mockSetPassword).toHaveBeenCalledTimes(1);
            (0, vitest_1.expect)(mockSetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:password', 'secretpassword');
        });
        (0, vitest_1.it)('should store only passphrase when password not provided', async () => {
            mockSetPassword.mockResolvedValue(undefined);
            await service.storeCredentials('conn-1', {
                passphrase: 'my-passphrase',
            });
            (0, vitest_1.expect)(mockSetPassword).toHaveBeenCalledTimes(1);
            (0, vitest_1.expect)(mockSetPassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:passphrase', 'my-passphrase');
        });
        (0, vitest_1.it)('should do nothing when no credentials provided', async () => {
            await service.storeCredentials('conn-1', {});
            (0, vitest_1.expect)(mockSetPassword).not.toHaveBeenCalled();
        });
        (0, vitest_1.it)('should delete all credentials', async () => {
            mockDeletePassword.mockResolvedValue(undefined);
            await service.deleteAllCredentials('conn-1');
            (0, vitest_1.expect)(mockDeletePassword).toHaveBeenCalledTimes(2);
            (0, vitest_1.expect)(mockDeletePassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:password');
            (0, vitest_1.expect)(mockDeletePassword).toHaveBeenCalledWith('emdash-ssh', 'conn-1:passphrase');
        });
        (0, vitest_1.it)('should not fail when deleting non-existent credentials', async () => {
            mockDeletePassword.mockRejectedValue(new Error('Not found'));
            // Should not throw
            await (0, vitest_1.expect)(service.deleteAllCredentials('conn-1')).resolves.not.toThrow();
        });
        (0, vitest_1.it)('should continue deleting when one credential fails', async () => {
            mockDeletePassword
                .mockRejectedValueOnce(new Error('Password not found'))
                .mockResolvedValueOnce(undefined);
            await service.deleteAllCredentials('conn-1');
            (0, vitest_1.expect)(mockDeletePassword).toHaveBeenCalledTimes(2);
        });
    });
    (0, vitest_1.describe)('service namespacing', () => {
        (0, vitest_1.it)('should use correct service name for all operations', async () => {
            mockSetPassword.mockResolvedValue(undefined);
            await service.storePassword('conn-1', 'pass');
            await service.storePassphrase('conn-1', 'phrase');
            const calls = mockSetPassword.mock.calls;
            (0, vitest_1.expect)(calls.every((call) => call[0] === 'emdash-ssh')).toBe(true);
        });
        (0, vitest_1.it)('should use correct key format for password', async () => {
            mockSetPassword.mockResolvedValue(undefined);
            await service.storePassword('my-connection', 'password');
            (0, vitest_1.expect)(mockSetPassword).toHaveBeenCalledWith('emdash-ssh', 'my-connection:password', 'password');
        });
        (0, vitest_1.it)('should use correct key format for passphrase', async () => {
            mockSetPassword.mockResolvedValue(undefined);
            await service.storePassphrase('my-connection', 'passphrase');
            (0, vitest_1.expect)(mockSetPassword).toHaveBeenCalledWith('emdash-ssh', 'my-connection:passphrase', 'passphrase');
        });
    });
});
