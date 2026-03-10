"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SshCredentialService = void 0;
const keytar_1 = __importDefault(require("keytar"));
const SERVICE_NAME = 'emdash-ssh';
/**
 * Service for managing SSH credentials securely.
 * Uses system keychain for password and passphrase storage via keytar.
 */
class SshCredentialService {
    /**
     * Store password for a connection
     * @param connectionId - Unique identifier for the connection
     * @param password - Password to store
     * @throws Error if storage fails
     */
    async storePassword(connectionId, password) {
        try {
            await keytar_1.default.setPassword(SERVICE_NAME, `${connectionId}:password`, password);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to store password for connection ${connectionId}: ${message}`);
        }
    }
    /**
     * Retrieve password for a connection
     * @param connectionId - Unique identifier for the connection
     * @returns The stored password or null if not found
     * @throws Error if retrieval fails
     */
    async getPassword(connectionId) {
        try {
            const credential = await keytar_1.default.getPassword(SERVICE_NAME, `${connectionId}:password`);
            return credential;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to retrieve password for connection ${connectionId}: ${message}`);
        }
    }
    /**
     * Delete stored password
     * @param connectionId - Unique identifier for the connection
     * @throws Error if deletion fails
     */
    async deletePassword(connectionId) {
        try {
            await keytar_1.default.deletePassword(SERVICE_NAME, `${connectionId}:password`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to delete password for connection ${connectionId}: ${message}`);
        }
    }
    /**
     * Checks if a password exists in the keychain.
     * @param connectionId - Unique identifier for the connection
     * @returns True if password exists
     */
    async hasPassword(connectionId) {
        try {
            const credential = await keytar_1.default.getPassword(SERVICE_NAME, `${connectionId}:password`);
            return credential !== null;
        }
        catch {
            return false;
        }
    }
    /**
     * Store passphrase for a private key
     * @param connectionId - Unique identifier for the connection
     * @param passphrase - Passphrase to store
     * @throws Error if storage fails
     */
    async storePassphrase(connectionId, passphrase) {
        try {
            await keytar_1.default.setPassword(SERVICE_NAME, `${connectionId}:passphrase`, passphrase);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to store passphrase for connection ${connectionId}: ${message}`);
        }
    }
    /**
     * Retrieve passphrase for a private key
     * @param connectionId - Unique identifier for the connection
     * @returns The stored passphrase or null if not found
     * @throws Error if retrieval fails
     */
    async getPassphrase(connectionId) {
        try {
            const credential = await keytar_1.default.getPassword(SERVICE_NAME, `${connectionId}:passphrase`);
            return credential;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to retrieve passphrase for connection ${connectionId}: ${message}`);
        }
    }
    /**
     * Delete stored passphrase
     * @param connectionId - Unique identifier for the connection
     * @throws Error if deletion fails
     */
    async deletePassphrase(connectionId) {
        try {
            await keytar_1.default.deletePassword(SERVICE_NAME, `${connectionId}:passphrase`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to delete passphrase for connection ${connectionId}: ${message}`);
        }
    }
    /**
     * Checks if a passphrase exists in the keychain.
     * @param connectionId - Unique identifier for the connection
     * @returns True if passphrase exists
     */
    async hasPassphrase(connectionId) {
        try {
            const credential = await keytar_1.default.getPassword(SERVICE_NAME, `${connectionId}:passphrase`);
            return credential !== null;
        }
        catch {
            return false;
        }
    }
    /**
     * Store both password and passphrase in one call
     * @param connectionId - Unique identifier for the connection
     * @param credentials - Object containing optional password and passphrase
     * @throws Error if any storage operation fails
     */
    async storeCredentials(connectionId, credentials) {
        const operations = [];
        if (credentials.password) {
            operations.push(this.storePassword(connectionId, credentials.password));
        }
        if (credentials.passphrase) {
            operations.push(this.storePassphrase(connectionId, credentials.passphrase));
        }
        if (operations.length > 0) {
            await Promise.all(operations);
        }
    }
    /**
     * Delete all credentials for a connection
     * @param connectionId - Unique identifier for the connection
     * @throws Error if any deletion operation fails
     */
    async deleteAllCredentials(connectionId) {
        await Promise.all([
            this.deletePassword(connectionId).catch(() => {
                // Ignore errors for individual deletions
            }),
            this.deletePassphrase(connectionId).catch(() => {
                // Ignore errors for individual deletions
            }),
        ]);
    }
}
exports.SshCredentialService = SshCredentialService;
