"use strict";
/**
 * FileSystem Factory
 * Creates appropriate IFileSystem implementation based on project configuration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileSystemFactory = void 0;
const LocalFileSystem_1 = require("./LocalFileSystem");
const RemoteFileSystem_1 = require("./RemoteFileSystem");
class FileSystemFactory {
    /**
     * Initialize the factory with SSH service
     */
    static initialize(sshService) {
        this.sshService = sshService;
    }
    /**
     * Create filesystem for a project
     */
    static create(project) {
        const cacheKey = project.id;
        // Return cached instance if available
        if (this.cache[cacheKey]) {
            return this.cache[cacheKey];
        }
        let fs;
        if (project.isRemote && project.sshConnectionId) {
            if (!this.sshService) {
                throw new Error('SSH service not initialized');
            }
            if (!project.remotePath) {
                throw new Error('Remote project missing remotePath');
            }
            fs = new RemoteFileSystem_1.RemoteFileSystem(this.sshService, project.sshConnectionId, project.remotePath);
        }
        else {
            fs = new LocalFileSystem_1.LocalFileSystem(project.path);
        }
        // Cache the instance
        this.cache[cacheKey] = fs;
        return fs;
    }
    /**
     * Get filesystem for a project (alias for create)
     */
    static get(project) {
        return this.create(project);
    }
    /**
     * Clear cache for a specific project
     */
    static clearCache(projectId) {
        delete this.cache[projectId];
    }
    /**
     * Clear all cached filesystems
     */
    static clearAllCache() {
        this.cache = {};
    }
    /**
     * Check if project uses remote filesystem
     */
    static isRemote(project) {
        return !!project.isRemote;
    }
    /**
     * Get connection ID for remote project
     */
    static getConnectionId(project) {
        return project.sshConnectionId || null;
    }
    /**
     * Dispose factory and clear all resources
     */
    static dispose() {
        this.clearAllCache();
        this.sshService = null;
    }
}
exports.FileSystemFactory = FileSystemFactory;
FileSystemFactory.cache = {};
FileSystemFactory.sshService = null;
