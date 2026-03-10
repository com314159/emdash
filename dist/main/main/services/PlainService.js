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
exports.PlainService = void 0;
const node_https_1 = require("node:https");
const node_url_1 = require("node:url");
const electron_1 = require("electron");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const PLAIN_API_URL = 'https://core-api.uk.plain.com/graphql/v1';
const REQUEST_TIMEOUT_MS = 15000;
const THREAD_FIELDS = `
  id ref title previewText status priority
  customer { id fullName email { email } }
  labels { labelType { id name } }
  updatedAt { iso8601 }
`;
class PlainService {
    constructor() {
        this.SERVICE_NAME = 'emdash-plain';
        this.ACCOUNT_NAME = 'api-token';
    }
    async saveToken(token) {
        try {
            const workspace = await this.fetchWorkspace(token);
            await this.storeToken(token);
            this.saveWorkspaceId(workspace.id);
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('plain_connected');
            });
            return {
                success: true,
                workspaceName: workspace.name ?? undefined,
            };
        }
        catch (error) {
            const message = error instanceof Error
                ? error.message
                : 'Failed to validate Plain token. Please try again.';
            return { success: false, error: message };
        }
    }
    async clearToken() {
        try {
            const keytar = await Promise.resolve().then(() => __importStar(require('keytar')));
            await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
            this.clearWorkspaceId();
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('plain_disconnected');
            });
            return { success: true };
        }
        catch (error) {
            console.error('Failed to clear Plain token:', error);
            return {
                success: false,
                error: 'Unable to remove Plain token from keychain.',
            };
        }
    }
    async checkConnection() {
        try {
            const token = await this.getStoredToken();
            if (!token) {
                return { connected: false };
            }
            const workspace = await this.fetchWorkspace(token);
            return {
                connected: true,
                workspaceName: workspace.name ?? undefined,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to verify Plain connection.';
            return { connected: false, error: message };
        }
    }
    async initialFetch(limit = 50, statuses) {
        const token = await this.getStoredToken();
        if (!token) {
            throw new Error('Plain token not set. Connect Plain in settings first.');
        }
        const sanitizedLimit = Math.min(Math.max(limit, 1), 200);
        const workspaceId = this.loadWorkspaceId();
        const hasStatuses = statuses && statuses.length > 0;
        const query = hasStatuses
            ? `
      query ListThreads($first: Int!, $statuses: [ThreadStatus!]!) {
        threads(first: $first, filters: { statuses: $statuses }, sortBy: { field: CREATED_AT, direction: DESC }) {
          edges { node { ${THREAD_FIELDS} } }
        }
      }
    `
            : `
      query ListThreads($first: Int!) {
        threads(first: $first, sortBy: { field: CREATED_AT, direction: DESC }) {
          edges { node { ${THREAD_FIELDS} } }
        }
      }
    `;
        const variables = { first: sanitizedLimit };
        if (hasStatuses)
            variables.statuses = statuses;
        const response = await this.graphql(token, query, variables);
        const threads = (response?.threads?.edges ?? []).map((edge) => this.mapThread(edge.node, workspaceId));
        return threads;
    }
    async searchThreads(searchTerm, limit = 20) {
        const token = await this.getStoredToken();
        if (!token) {
            throw new Error('Plain token not set. Connect Plain in settings first.');
        }
        const trimmed = searchTerm.trim();
        if (!trimmed) {
            return [];
        }
        const workspaceId = this.loadWorkspaceId();
        const isRefSearch = /^T-\d+$/i.test(trimmed);
        try {
            if (isRefSearch) {
                return await this.fetchThreadByRef(token, trimmed.toUpperCase(), workspaceId);
            }
            // Plain has no server-side text search — fetch a wide batch and filter client-side
            const fetchSize = 200;
            const resultLimit = Math.min(Math.max(limit, 1), 200);
            const query = `
        query SearchThreads($first: Int!) {
          threads(first: $first, sortBy: { field: CREATED_AT, direction: DESC }) {
            edges { node { ${THREAD_FIELDS} } }
          }
        }
      `;
            const response = await this.graphql(token, query, { first: fetchSize });
            const lowerTerm = trimmed.toLowerCase();
            const threads = (response?.threads?.edges ?? [])
                .map((edge) => this.mapThread(edge.node, workspaceId))
                .filter((t) => (t.title && t.title.toLowerCase().includes(lowerTerm)) ||
                (t.ref && t.ref.toLowerCase().includes(lowerTerm)) ||
                (t.customer?.fullName && t.customer.fullName.toLowerCase().includes(lowerTerm)) ||
                (t.customer?.email && t.customer.email.toLowerCase().includes(lowerTerm)))
                .slice(0, resultLimit);
            return threads;
        }
        catch (error) {
            console.error('[Plain] searchThreads error:', error);
            return [];
        }
    }
    async fetchThreadByRef(token, ref, workspaceId) {
        const query = `
      query GetThreadByRef($ref: String!) {
        threadByRef(ref: $ref) { ${THREAD_FIELDS} }
      }
    `;
        try {
            const response = await this.graphql(token, query, { ref });
            if (!response?.threadByRef)
                return [];
            return [this.mapThread(response.threadByRef, workspaceId)];
        }
        catch {
            return [];
        }
    }
    mapThread(node, workspaceId) {
        return {
            id: node.id,
            ref: node.ref ?? null,
            title: node.title ?? '',
            description: node.previewText ?? node.description ?? null,
            status: node.status ?? null,
            priority: node.priority ?? null,
            customer: node.customer
                ? {
                    id: node.customer.id,
                    fullName: node.customer.fullName ?? null,
                    email: node.customer.email?.email ?? null,
                }
                : null,
            labels: Array.isArray(node.labels)
                ? node.labels.map((l) => ({
                    id: l.labelType?.id ?? l.id,
                    name: l.labelType?.name ?? l.name ?? null,
                }))
                : null,
            updatedAt: node.updatedAt?.iso8601 ?? null,
            url: workspaceId ? `https://app.plain.com/workspace/${workspaceId}/t/${node.id}` : null,
        };
    }
    async fetchWorkspace(token) {
        const query = `
      query WorkspaceInfo {
        myWorkspace {
          id
          name
        }
      }
    `;
        const data = await this.graphql(token, query);
        if (!data?.myWorkspace) {
            throw new Error('Unable to retrieve Plain workspace information.');
        }
        return data.myWorkspace;
    }
    saveWorkspaceId(workspaceId) {
        try {
            const filePath = (0, node_path_1.join)(electron_1.app.getPath('userData'), 'plain.json');
            (0, node_fs_1.writeFileSync)(filePath, JSON.stringify({ workspaceId }), 'utf-8');
        }
        catch (error) {
            console.error('Failed to save Plain workspace ID:', error);
        }
    }
    loadWorkspaceId() {
        try {
            const filePath = (0, node_path_1.join)(electron_1.app.getPath('userData'), 'plain.json');
            const data = JSON.parse((0, node_fs_1.readFileSync)(filePath, 'utf-8'));
            return data?.workspaceId ?? null;
        }
        catch {
            return null;
        }
    }
    clearWorkspaceId() {
        try {
            (0, node_fs_1.unlinkSync)((0, node_path_1.join)(electron_1.app.getPath('userData'), 'plain.json'));
        }
        catch {
            // file may not exist
        }
    }
    async graphql(token, query, variables) {
        const body = JSON.stringify({ query, variables });
        const requestPromise = new Promise((resolve, reject) => {
            const url = new node_url_1.URL(PLAIN_API_URL);
            const req = (0, node_https_1.request)({
                hostname: url.hostname,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'Content-Length': Buffer.byteLength(body).toString(),
                },
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode === 401 || res.statusCode === 403) {
                        reject(new Error('Invalid API key. Please check your Plain API key and try again.'));
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    }
                    catch (error) {
                        reject(error);
                    }
                });
            });
            req.setTimeout(REQUEST_TIMEOUT_MS, () => {
                req.destroy(new Error('Plain API request timed out.'));
            });
            req.on('error', (error) => {
                reject(error);
            });
            req.write(body);
            req.end();
        });
        const result = await requestPromise;
        if (result.errors?.length) {
            throw new Error(result.errors.map((err) => err.message).join('\n'));
        }
        if (!result.data) {
            throw new Error('Plain API returned no data.');
        }
        return result.data;
    }
    async storeToken(token) {
        const clean = token.trim();
        if (!clean) {
            throw new Error('Plain token cannot be empty.');
        }
        try {
            const keytar = await Promise.resolve().then(() => __importStar(require('keytar')));
            await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, clean);
        }
        catch (error) {
            console.error('Failed to store Plain token:', error);
            throw new Error('Unable to store Plain token securely.');
        }
    }
    async getStoredToken() {
        try {
            const keytar = await Promise.resolve().then(() => __importStar(require('keytar')));
            return await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
        }
        catch (error) {
            console.error('Failed to read Plain token from keychain:', error);
            return null;
        }
    }
}
exports.PlainService = PlainService;
exports.default = PlainService;
