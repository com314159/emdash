"use strict";
/**
 * Filesystem abstraction layer types
 * Provides unified interface for local and remote (SSH/SFTP) filesystem operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileSystemErrorCodes = exports.FileSystemError = void 0;
/**
 * Base error class for filesystem operations
 */
class FileSystemError extends Error {
    constructor(message, code, path) {
        super(message);
        this.code = code;
        this.path = path;
        this.name = 'FileSystemError';
    }
}
exports.FileSystemError = FileSystemError;
/**
 * Error codes for filesystem operations
 */
exports.FileSystemErrorCodes = {
    PATH_ESCAPE: 'PATH_ESCAPE',
    NOT_FOUND: 'NOT_FOUND',
    IS_DIRECTORY: 'IS_DIRECTORY',
    NOT_DIRECTORY: 'NOT_DIRECTORY',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    INVALID_PATH: 'INVALID_PATH',
    CONNECTION_ERROR: 'CONNECTION_ERROR',
    TIMEOUT: 'TIMEOUT',
    UNKNOWN: 'UNKNOWN',
};
