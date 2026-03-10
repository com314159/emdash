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
exports.LinearService = void 0;
const node_https_1 = require("node:https");
const node_url_1 = require("node:url");
const issueSorting_1 = require("../utils/issueSorting");
const LINEAR_API_URL = 'https://api.linear.app/graphql';
class LinearService {
    constructor() {
        this.SERVICE_NAME = 'emdash-linear';
        this.ACCOUNT_NAME = 'api-token';
    }
    async saveToken(token) {
        try {
            const viewer = await this.fetchViewer(token);
            await this.storeToken(token);
            // Track connection
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('linear_connected');
            });
            return {
                success: true,
                workspaceName: viewer?.organization?.name ?? viewer?.displayName ?? undefined,
            };
        }
        catch (error) {
            const message = error instanceof Error
                ? error.message
                : 'Failed to validate Linear token. Please try again.';
            return { success: false, error: message };
        }
    }
    async clearToken() {
        try {
            const keytar = await Promise.resolve().then(() => __importStar(require('keytar')));
            await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
            // Track disconnection
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('linear_disconnected');
            });
            return { success: true };
        }
        catch (error) {
            console.error('Failed to clear Linear token:', error);
            return {
                success: false,
                error: 'Unable to remove Linear token from keychain.',
            };
        }
    }
    async checkConnection() {
        try {
            const token = await this.getStoredToken();
            if (!token) {
                return { connected: false };
            }
            const viewer = await this.fetchViewer(token);
            return {
                connected: true,
                workspaceName: viewer?.organization?.name ?? viewer?.displayName ?? undefined,
                viewer,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to verify Linear connection.';
            return { connected: false, error: message };
        }
    }
    async initialFetch(limit = 50) {
        const token = await this.getStoredToken();
        if (!token) {
            throw new Error('Linear token not set. Connect Linear in settings first.');
        }
        const sanitizedLimit = Math.min(Math.max(limit, 1), 200);
        // Use server-side filter to exclude completed/canceled issues so we get a full
        // page of open issues instead of fetching N and discarding closed ones.
        const query = `
      query ListIssues($limit: Int!) {
        issues(
          first: $limit,
          orderBy: updatedAt,
          filter: { state: { type: { nin: ["completed", "cancelled"] } } }
        ) {
          nodes {
            id
            identifier
            title
            description
            url
            state { name type color }
            team { name key }
            project { name }
            assignee { displayName name }
            updatedAt
          }
        }
      }
    `;
        const response = await this.graphql(token, query, {
            limit: sanitizedLimit,
        });
        return (0, issueSorting_1.sortByUpdatedAtDesc)(response?.issues?.nodes ?? []);
    }
    async searchIssues(searchTerm, limit = 20) {
        const token = await this.getStoredToken();
        if (!token) {
            throw new Error('Linear token not set. Connect Linear in settings first.');
        }
        if (!searchTerm.trim()) {
            return [];
        }
        const sanitizedLimit = Math.min(Math.max(limit, 1), 200);
        // Use Linear's server-side searchIssues query for full-text search across all issues
        const searchQuery = `
      query SearchIssues($term: String!, $limit: Int!) {
        searchIssues(term: $term, first: $limit) {
          nodes {
            id
            identifier
            title
            description
            url
            state { name type color }
            team { name key }
            project { name }
            assignee { displayName name }
            updatedAt
          }
        }
      }
    `;
        try {
            const searchResponse = await this.graphql(token, searchQuery, {
                term: searchTerm.trim(),
                limit: sanitizedLimit,
            });
            return (0, issueSorting_1.sortByUpdatedAtDesc)(searchResponse?.searchIssues?.nodes ?? []);
        }
        catch (error) {
            console.error('[Linear] searchIssues error:', error);
            return [];
        }
    }
    async fetchViewer(token) {
        const query = `
      query ViewerInfo {
        viewer {
          name
          displayName
          organization {
            name
          }
        }
      }
    `;
        const data = await this.graphql(token, query);
        if (!data?.viewer) {
            throw new Error('Unable to retrieve Linear account information.');
        }
        return data.viewer;
    }
    async graphql(token, query, variables) {
        const body = JSON.stringify({ query, variables });
        const requestPromise = new Promise((resolve, reject) => {
            const url = new node_url_1.URL(LINEAR_API_URL);
            const req = (0, node_https_1.request)({
                hostname: url.hostname,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: token,
                    'Content-Length': Buffer.byteLength(body).toString(),
                },
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    }
                    catch (error) {
                        reject(error);
                    }
                });
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
            throw new Error('Linear API returned no data.');
        }
        return result.data;
    }
    async storeToken(token) {
        const clean = token.trim();
        if (!clean) {
            throw new Error('Linear token cannot be empty.');
        }
        try {
            const keytar = await Promise.resolve().then(() => __importStar(require('keytar')));
            await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, clean);
        }
        catch (error) {
            console.error('Failed to store Linear token:', error);
            throw new Error('Unable to store Linear token securely.');
        }
    }
    async getStoredToken() {
        try {
            const keytar = await Promise.resolve().then(() => __importStar(require('keytar')));
            return await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
        }
        catch (error) {
            console.error('Failed to read Linear token from keychain:', error);
            return null;
        }
    }
}
exports.LinearService = LinearService;
exports.default = LinearService;
