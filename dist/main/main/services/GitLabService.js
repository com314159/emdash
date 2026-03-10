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
exports.gitlabService = exports.GitLabService = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const electron_1 = require("electron");
const util_1 = require("util");
const child_process_1 = require("child_process");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class GitLabService {
    constructor() {
        this.SERVICE_NAME = 'emdash-gitlab';
        this.ACCOUNT_NAME = 'gitlab-token';
        this.CONF_FILE = (0, path_1.join)(electron_1.app.getPath('userData'), 'gitlab.json');
    }
    async saveCredentials(siteUrl, token) {
        try {
            siteUrl = siteUrl.trim();
            token = token.trim();
            if (siteUrl.length == 0 || token.length == 0) {
                return { success: false, error: 'Instance URL and token are required' };
            }
            const regex = /^https?:\/\/([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d{1,5})?\/?$/;
            if (!regex.test(siteUrl)) {
                return { success: false, error: 'Invalid URL format' };
            }
            if (siteUrl[siteUrl.length - 1] == '/') {
                siteUrl = siteUrl.substring(0, siteUrl.length - 1);
            }
            const keytar = await Promise.resolve().then(() => __importStar(require('keytar')));
            await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, token);
            this.writeCreds({ siteUrl: siteUrl });
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e?.message };
        }
    }
    async clearCredentials() {
        try {
            const keytar = await Promise.resolve().then(() => __importStar(require('keytar')));
            await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
            if ((0, fs_1.existsSync)(this.CONF_FILE)) {
                (0, fs_1.unlinkSync)(this.CONF_FILE);
            }
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e?.message };
        }
    }
    async checkConnection() {
        try {
            const { siteUrl, token } = await this.requireAuth();
            const user = await this.getUserInfo(siteUrl, token);
            if (!user.success) {
                return { success: false, error: user.error };
            }
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e?.message };
        }
    }
    async initialFetch(projectPath, limit = 10) {
        try {
            const { siteUrl, token } = await this.requireAuth();
            if (!siteUrl || !token) {
                return { success: false, error: 'Gitlab is not configured' };
            }
            if (!projectPath) {
                return { success: false, error: 'Project path is required' };
            }
            const { success, id, error } = await this.resolveProjectId(projectPath);
            if (!success) {
                return { success: false, error: error };
            }
            if (!id) {
                return { success: false, error: 'Unable to resolve project ID' };
            }
            const issues = await this.fetchIssues(id, limit);
            return { success: true, issues: issues };
        }
        catch (e) {
            return { success: false, error: e?.message };
        }
    }
    async searchIssues(projectPath, searchTerm, limit = 10) {
        try {
            if (!searchTerm || !searchTerm.trim()) {
                return { success: true, issues: [] };
            }
            const { siteUrl, token } = await this.requireAuth();
            if (!siteUrl || !token) {
                return { success: false, error: 'GitLab is not configured' };
            }
            if (!projectPath) {
                return { success: false, error: 'Project path is required' };
            }
            const { success, id, error } = await this.resolveProjectId(projectPath);
            if (!success) {
                return { success: false, error };
            }
            if (!id) {
                return { success: false, error: 'Unable to resolve project ID' };
            }
            const url = new URL(`${siteUrl}/api/v4/projects/${encodeURIComponent(id)}/issues`);
            url.searchParams.set('search', searchTerm.trim());
            url.searchParams.set('in', 'title,description');
            url.searchParams.set('per_page', String(limit));
            url.searchParams.set('order_by', 'updated_at');
            url.searchParams.set('sort', 'desc');
            const response = await this.doRequest(url, token, 'GET');
            if (!response.ok) {
                return { success: false, error: 'Failed to search GitLab issues' };
            }
            const data = (await response.json());
            return { success: true, issues: this.normalizeIssues(data) };
        }
        catch (e) {
            return { success: false, error: e?.message };
        }
    }
    async resolveProjectId(projectPath) {
        try {
            const { siteUrl } = await this.requireAuth();
            const instanceHost = new URL(siteUrl).hostname.toLowerCase();
            const { stdout } = await this.execCmd('git remote get-url origin', {
                cwd: projectPath,
            });
            const remoteUrl = stdout.trim();
            if (!remoteUrl) {
                return { success: false, error: 'No remote URL found for origin' };
            }
            let remoteHost;
            let slug;
            if (remoteUrl.startsWith('git@')) {
                // SSH: git@gitlab.com:group/subgroup/project.git
                const hostMatch = remoteUrl.match(/^git@([^:]+):/);
                if (hostMatch) {
                    remoteHost = hostMatch[1].toLowerCase();
                }
                const slugMatch = remoteUrl.match(/:(.*?)(\.git)?$/);
                if (slugMatch && slugMatch[1]) {
                    slug = slugMatch[1];
                }
            }
            else if (remoteUrl.startsWith('https://') || remoteUrl.startsWith('http://')) {
                // HTTPS: https://<host>/group/subgroup/project.git
                const parsed = new URL(remoteUrl);
                remoteHost = parsed.hostname.toLowerCase();
                slug = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '');
            }
            if (remoteHost && remoteHost !== instanceHost) {
                return {
                    success: false,
                    error: `Git remote host "${remoteHost}" does not match configured GitLab instance "${instanceHost}". Check your GitLab settings or configure a project path override.`,
                };
            }
            if (!slug) {
                return { success: false, error: 'Unable to extract GitLab project slug from remote URL' };
            }
            slug = encodeURIComponent(slug.trim());
            const { id } = await this.getProjectId(slug);
            return { success: true, id: id };
        }
        catch (e) {
            return { success: false, error: 'Unable to resolve project ID' };
        }
    }
    async fetchIssues(projectId, limit = 10) {
        try {
            const { siteUrl, token } = await this.requireAuth();
            if (!siteUrl || !token) {
                throw new Error('Gitlab is not configured');
            }
            const url = new URL(`${siteUrl}/api/v4/projects/${projectId}/issues?state=opened&order_by=updated_at&sort=desc&per_page=${limit}`);
            const response = await this.doRequest(url, token, 'GET');
            if (!response.ok) {
                throw new Error('could not fetch issues');
            }
            const data = (await response.json());
            return this.normalizeIssues(data);
        }
        catch (e) {
            throw e;
        }
    }
    normalizeIssues(issues) {
        return issues.map((issue) => ({
            id: issue.id,
            iid: issue.iid,
            title: issue.title,
            description: issue.description,
            web_url: issue.web_url,
            state: issue.state,
            project: issue.project,
            assignee: issue.assignee,
            labels: issue.labels,
            updated_at: issue.updated_at,
        }));
    }
    async execCmd(cmd, options) {
        try {
            const result = await execAsync(cmd, { encoding: 'utf8', ...options });
            return {
                stdout: result.stdout.toString(),
                stderr: result.stderr.toString(),
            };
        }
        catch (e) {
            throw e;
        }
    }
    async getProjectId(projectSlug) {
        try {
            const { siteUrl, token } = await this.requireAuth();
            const url = new URL(`${siteUrl}/api/v4/projects/${projectSlug}`);
            const res = await this.doRequest(url, token, 'GET');
            if (!res.ok) {
                throw new Error('Failed to fetch project Id');
            }
            const data = await res.json();
            if (!data['id']) {
                throw new Error('Error while retriving the Id');
            }
            return { id: data['id'] };
        }
        catch (e) {
            throw e;
        }
    }
    async doRequest(url, token, method, payload, extraHeaders) {
        return fetch(url.toString(), {
            method,
            headers: {
                'PRIVATE-TOKEN': token,
                ...(extraHeaders || {}),
            },
            body: method === 'POST' ? payload : undefined,
        });
    }
    async requireAuth() {
        try {
            const creds = this.readCreds();
            if (!creds) {
                throw new Error('Invalid credential files');
            }
            const keytar = await Promise.resolve().then(() => __importStar(require('keytar')));
            const token = await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
            if (!token) {
                throw new Error('Token does not set');
            }
            return { siteUrl: creds.siteUrl, token: token };
        }
        catch (e) {
            throw new Error(e?.message);
        }
    }
    async getUserInfo(siteUrl, token) {
        try {
            const url = new URL(`${siteUrl}/api/v4/user`);
            const response = await this.doRequest(url, token, 'GET');
            if (!response.ok) {
                return { success: false, error: 'Failed to get user info' };
            }
            const user = await response.json();
            return { success: true, user: user };
        }
        catch (e) {
            return { success: false, error: e?.message };
        }
    }
    writeCreds(creds) {
        try {
            const { siteUrl } = creds;
            const obj = { siteUrl };
            (0, fs_1.writeFileSync)(this.CONF_FILE, JSON.stringify(obj), 'utf8');
        }
        catch (error) {
            console.error('Failed to write GitLab credentials:', error);
        }
    }
    readCreds() {
        try {
            if (!(0, fs_1.existsSync)(this.CONF_FILE))
                return null;
            const raw = (0, fs_1.readFileSync)(this.CONF_FILE, 'utf8');
            const obj = JSON.parse(raw);
            return { siteUrl: obj.siteUrl };
        }
        catch (error) {
            console.error('Failed to read GitLab credentials:', error);
            return null;
        }
    }
}
exports.GitLabService = GitLabService;
exports.gitlabService = new GitLabService();
