"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepositoryManager = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class RepositoryManager {
    constructor() {
        this.repos = new Map();
    }
    async scanRepositories() {
        // Need to implement actual repository scanning
        // For now, return empty array
        return [];
    }
    async addRepository(path) {
        try {
            // Validate that the path is a git repository
            const { stdout } = await execAsync(`cd "${path}" && git rev-parse --is-inside-work-tree`);
            if (stdout.trim() !== 'true') {
                throw new Error('Not a git repository');
            }
            // Get repository info
            const [origin, defaultBranch] = await Promise.all([
                this.getOrigin(path),
                this.getDefaultBranch(path),
            ]);
            const repo = {
                id: this.generateId(),
                path,
                origin,
                defaultBranch,
                lastActivity: new Date().toISOString(),
            };
            this.repos.set(repo.id, repo);
            return repo;
        }
        catch (error) {
            throw new Error(`Failed to add repository: ${error}`);
        }
    }
    async getOrigin(path) {
        try {
            const { stdout } = await execAsync(`cd "${path}" && git remote get-url origin`);
            return stdout.trim();
        }
        catch {
            return 'No origin';
        }
    }
    async getDefaultBranch(path) {
        try {
            const { stdout } = await execAsync(`cd "${path}" && git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'`);
            return stdout.trim() || 'main';
        }
        catch {
            return 'main';
        }
    }
    generateId() {
        return Math.random().toString(36).substr(2, 9);
    }
    getRepository(id) {
        return this.repos.get(id);
    }
    getAllRepositories() {
        return Array.from(this.repos.values());
    }
}
exports.RepositoryManager = RepositoryManager;
