"use strict";
/**
 * Filesystem Abstraction Layer
 *
 * Provides unified interface for local and remote (SSH/SFTP) filesystem operations.
 * This module is part of Wave 1 (interfaces and structure).
 *
 * Wave 2 will implement:
 * - LocalFileSystem: wrapping existing fsIpc functionality
 * - RemoteFileSystem: SFTP-based implementation using ssh2
 * - FileSystemFactory: factory pattern for creating appropriate FS instances
 *
 * Usage:
 *   import { FileSystemFactory, IFileSystem } from './services/fs';
 *
 *   const fs: IFileSystem = FileSystemFactory.create(project);
 *   const result = await fs.read('src/index.ts');
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileSystemFactory = exports.RemoteFileSystem = exports.LocalFileSystem = exports.FileSystemErrorCodes = exports.FileSystemError = void 0;
var types_1 = require("./types");
Object.defineProperty(exports, "FileSystemError", { enumerable: true, get: function () { return types_1.FileSystemError; } });
Object.defineProperty(exports, "FileSystemErrorCodes", { enumerable: true, get: function () { return types_1.FileSystemErrorCodes; } });
// Implementations (stubs in Wave 1)
var LocalFileSystem_1 = require("./LocalFileSystem");
Object.defineProperty(exports, "LocalFileSystem", { enumerable: true, get: function () { return LocalFileSystem_1.LocalFileSystem; } });
var RemoteFileSystem_1 = require("./RemoteFileSystem");
Object.defineProperty(exports, "RemoteFileSystem", { enumerable: true, get: function () { return RemoteFileSystem_1.RemoteFileSystem; } });
var FileSystemFactory_1 = require("./FileSystemFactory");
Object.defineProperty(exports, "FileSystemFactory", { enumerable: true, get: function () { return FileSystemFactory_1.FileSystemFactory; } });
