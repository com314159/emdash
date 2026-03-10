"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectSettingsService = void 0;
const DatabaseService_1 = require("./DatabaseService");
class ProjectSettingsService {
    async getProjectSettings(projectId) {
        if (!projectId) {
            throw new Error('projectId is required');
        }
        const project = await DatabaseService_1.databaseService.getProjectById(projectId);
        if (!project) {
            return null;
        }
        return this.toSettings(project);
    }
    async updateProjectSettings(projectId, settings) {
        if (!projectId) {
            throw new Error('projectId is required');
        }
        const nextBaseRef = settings?.baseRef;
        if (typeof nextBaseRef !== 'string') {
            throw new Error('baseRef is required');
        }
        const project = await DatabaseService_1.databaseService.updateProjectBaseRef(projectId, nextBaseRef);
        if (!project) {
            throw new Error('Project not found');
        }
        return this.toSettings(project);
    }
    toSettings(project) {
        return {
            projectId: project.id,
            name: project.name,
            path: project.path,
            gitRemote: project.gitInfo.remote,
            gitBranch: project.gitInfo.branch,
            baseRef: project.gitInfo.baseRef,
        };
    }
}
exports.projectSettingsService = new ProjectSettingsService();
