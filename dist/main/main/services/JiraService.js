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
const node_https_1 = require("node:https");
const node_url_1 = require("node:url");
const electron_1 = require("electron");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const issueSorting_1 = require("../utils/issueSorting");
function encodeBasic(email, token) {
    const raw = `${email}:${token}`;
    return Buffer.from(raw).toString('base64');
}
class JiraService {
    constructor() {
        this.SERVICE = 'emdash-jira';
        this.ACCOUNT = 'api-token';
        this.CONF_FILE = (0, node_path_1.join)(electron_1.app.getPath('userData'), 'jira.json');
        this.projectKeys = [];
    }
    readCreds() {
        try {
            if (!(0, node_fs_1.existsSync)(this.CONF_FILE))
                return null;
            const raw = (0, node_fs_1.readFileSync)(this.CONF_FILE, 'utf8');
            const obj = JSON.parse(raw);
            const siteUrl = String(obj?.siteUrl || '').trim();
            const email = String(obj?.email || '').trim();
            if (!siteUrl || !email)
                return null;
            return { siteUrl, email };
        }
        catch {
            return null;
        }
    }
    writeCreds(creds) {
        const { siteUrl, email } = creds;
        const obj = { siteUrl, email };
        (0, node_fs_1.writeFileSync)(this.CONF_FILE, JSON.stringify(obj), 'utf8');
    }
    async saveCredentials(siteUrl, email, token) {
        try {
            const me = await this.getMyself(siteUrl, email, token);
            const keytar = await Promise.resolve().then(() => __importStar(require('keytar')));
            await keytar.setPassword(this.SERVICE, this.ACCOUNT, token);
            this.writeCreds({ siteUrl, email });
            // Track connection
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('jira_connected');
            });
            return { success: true, displayName: me?.displayName };
        }
        catch (e) {
            return { success: false, error: e?.message || String(e) };
        }
    }
    async clearCredentials() {
        try {
            const keytar = await Promise.resolve().then(() => __importStar(require('keytar')));
            this.projectKeys = [];
            try {
                await keytar.deletePassword(this.SERVICE, this.ACCOUNT);
            }
            catch { }
            try {
                if ((0, node_fs_1.existsSync)(this.CONF_FILE))
                    (0, node_fs_1.unlinkSync)(this.CONF_FILE);
            }
            catch { }
            // Track disconnection
            void Promise.resolve().then(() => __importStar(require('../telemetry'))).then(({ capture }) => {
                void capture('jira_disconnected');
            });
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e?.message || String(e) };
        }
    }
    async checkConnection() {
        try {
            const creds = this.readCreds();
            if (!creds)
                return { connected: false };
            const keytar = await Promise.resolve().then(() => __importStar(require('keytar')));
            const token = await keytar.getPassword(this.SERVICE, this.ACCOUNT);
            if (!token)
                return { connected: false };
            const me = await this.getMyself(creds.siteUrl, creds.email, token);
            this.fetchProjectKeys(creds.siteUrl, creds.email, token)
                .then((keys) => {
                this.projectKeys = keys;
            })
                .catch(() => { });
            return {
                connected: true,
                accountId: me?.accountId,
                displayName: me?.displayName,
                siteUrl: creds.siteUrl,
            };
        }
        catch (e) {
            return { connected: false, error: e?.message || String(e) };
        }
    }
    async initialFetch(limit = 50) {
        const { siteUrl, email, token } = await this.requireAuth();
        const jqlCandidates = [];
        // Pragmatic fallbacks that typically work with limited permissions
        jqlCandidates.push('assignee = currentUser() ORDER BY updated DESC', 'reporter = currentUser() ORDER BY updated DESC', 'ORDER BY updated DESC');
        for (const jql of jqlCandidates) {
            try {
                const issues = await this.searchRaw(siteUrl, email, token, jql, limit);
                if (issues.length > 0)
                    return (0, issueSorting_1.sortByUpdatedAtDesc)(this.normalizeIssues(siteUrl, issues));
            }
            catch {
                // Try next candidate if this one is forbidden or failed
            }
        }
        // Final fallback: use issue picker to get recent/history issues, then hydrate via GET /issue/{key}
        try {
            const keys = await this.getRecentIssueKeys(siteUrl, email, token, limit);
            if (keys.length > 0) {
                const results = [];
                for (const key of keys.slice(0, limit)) {
                    try {
                        const issue = await this.getIssueByKey(siteUrl, email, token, key);
                        if (issue)
                            results.push(issue);
                    }
                    catch {
                        // skip individual failures
                    }
                }
                if (results.length > 0)
                    return (0, issueSorting_1.sortByUpdatedAtDesc)(this.normalizeIssues(siteUrl, results));
            }
        }
        catch {
            // ignore
        }
        return [];
    }
    async searchIssues(searchTerm, limit = 20) {
        const term = (searchTerm || '').trim();
        if (!term)
            return [];
        const { siteUrl, email, token } = await this.requireAuth();
        const sanitized = term.replace(/\"/g, '\\\"');
        const inner = `text ~ \"${sanitized}\" OR key = ${term}`;
        const jql = inner;
        const data = await this.searchRaw(siteUrl, email, token, jql, limit);
        return (0, issueSorting_1.sortByUpdatedAtDesc)(this.normalizeIssues(siteUrl, data));
    }
    async requireAuth() {
        const creds = this.readCreds();
        if (!creds)
            throw new Error('Jira credentials not set.');
        const keytar = await Promise.resolve().then(() => __importStar(require('keytar')));
        const token = await keytar.getPassword(this.SERVICE, this.ACCOUNT);
        if (!token)
            throw new Error('Jira token not found.');
        return { ...creds, token };
    }
    async getMyself(siteUrl, email, token) {
        const url = new node_url_1.URL('/rest/api/3/myself', siteUrl);
        const body = await this.doGet(url, email, token);
        const data = JSON.parse(body || '{}');
        if (!data || data.errorMessages) {
            throw new Error('Failed to verify Jira token.');
        }
        return data;
    }
    async searchRaw(siteUrl, email, token, jql, limit) {
        const url = new node_url_1.URL('/rest/api/3/search', siteUrl);
        const payload = JSON.stringify({
            jql,
            maxResults: Math.min(Math.max(limit, 1), 100),
            fields: ['summary', 'description', 'updated', 'project', 'status', 'assignee'],
        });
        const body = await this.doRequest(url, email, token, 'POST', payload, {
            'Content-Type': 'application/json',
        });
        const data = JSON.parse(body || '{}');
        return Array.isArray(data?.issues) ? data.issues : [];
    }
    async doGet(url, email, token) {
        return this.doRequest(url, email, token, 'GET');
    }
    async doRequest(url, email, token, method, payload, extraHeaders) {
        const auth = encodeBasic(email, token);
        return await new Promise((resolve, reject) => {
            const req = (0, node_https_1.request)({
                hostname: url.hostname,
                path: url.pathname + url.search,
                protocol: url.protocol,
                method,
                headers: {
                    Authorization: `Basic ${auth}`,
                    Accept: 'application/json',
                    ...(extraHeaders || {}),
                },
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        const snippet = data?.slice(0, 200) || '';
                        return reject(new Error(`Jira API error ${res.statusCode}${snippet ? `: ${snippet}` : ''}`));
                    }
                    resolve(data);
                });
            });
            req.on('error', reject);
            if (payload && method === 'POST') {
                req.write(payload);
            }
            req.end();
        });
    }
    // Enhanced search that supports direct issue-key lookups and robust quoting
    async smartSearchIssues(searchTerm, limit = 20) {
        const term = (searchTerm || '').trim();
        if (!term)
            return [];
        const { siteUrl, email, token } = await this.requireAuth();
        const looksLikeKey = /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(term);
        if (looksLikeKey) {
            const keyUpper = term.toUpperCase();
            try {
                const issue = await this.getIssueByKey(siteUrl, email, token, keyUpper);
                if (issue)
                    return (0, issueSorting_1.sortByUpdatedAtDesc)(this.normalizeIssues(siteUrl, [issue]));
            }
            catch {
                // If direct fetch fails (404/403/etc.), falling back to JQL search below
            }
        }
        // Build JQL safely (escape quotes in term)
        const sanitized = term.replace(/"/g, '\\"');
        const extraKey = looksLikeKey ? ` OR issueKey = ${term.toUpperCase()}` : '';
        const isNumeric = /^\d+$/.test(term);
        const keyClause = isNumeric && this.projectKeys.length
            ? ` OR key IN (${this.projectKeys.map((p) => `"${p}-${term}"`).join(',')})`
            : '';
        const jql = `text ~ "${sanitized}"${extraKey}${keyClause}`;
        const data = await this.searchRaw(siteUrl, email, token, jql, limit);
        return (0, issueSorting_1.sortByUpdatedAtDesc)(this.normalizeIssues(siteUrl, data));
    }
    async fetchProjectKeys(siteUrl, email, token) {
        try {
            const url = new node_url_1.URL('/rest/api/3/project', siteUrl);
            const body = await this.doGet(url, email, token);
            const data = JSON.parse(body || '[]');
            if (!Array.isArray(data))
                return [];
            return data.map((p) => String(p?.key || '')).filter(Boolean);
        }
        catch {
            return [];
        }
    }
    async getIssueByKey(siteUrl, email, token, key) {
        const url = new node_url_1.URL(`/rest/api/3/issue/${encodeURIComponent(key)}`, siteUrl);
        url.searchParams.set('fields', 'summary,description,updated,project,status,assignee');
        const body = await this.doGet(url, email, token);
        const data = JSON.parse(body || '{}');
        if (!data || data.errorMessages)
            return null;
        return data;
    }
    async getRecentIssueKeys(siteUrl, email, token, limit) {
        // Jira issue picker provides recent/history issue suggestions
        const url = new node_url_1.URL('/rest/api/3/issue/picker', siteUrl);
        url.searchParams.set('query', '');
        url.searchParams.set('currentJQL', '');
        const body = await this.doGet(url, email, token);
        const data = JSON.parse(body || '{}');
        const keys = [];
        const sections = Array.isArray(data?.sections) ? data.sections : [];
        for (const sec of sections) {
            const issues = Array.isArray(sec?.issues) ? sec.issues : [];
            for (const it of issues) {
                const k = String(it?.key || '').trim();
                if (k && !keys.includes(k))
                    keys.push(k);
                if (keys.length >= limit)
                    break;
            }
            if (keys.length >= limit)
                break;
        }
        return keys;
    }
    static flattenAdf(node) {
        if (!node)
            return '';
        if (typeof node === 'string')
            return node;
        if (node.type === 'text')
            return node.text || '';
        if (Array.isArray(node.content)) {
            const parts = node.content.map((c) => JiraService.flattenAdf(c));
            // Add newlines between block-level nodes (paragraphs, headings, etc.)
            if (['doc', 'bulletList', 'orderedList'].includes(node.type)) {
                return parts.join('\n');
            }
            if (['paragraph', 'heading', 'listItem'].includes(node.type)) {
                return parts.join('');
            }
            return parts.join('');
        }
        return '';
    }
    normalizeIssues(siteUrl, rawIssues) {
        const base = siteUrl.replace(/\/$/, '');
        return (rawIssues || []).map((it) => {
            const fields = it?.fields || {};
            return {
                id: String(it?.id || it?.key || ''),
                key: String(it?.key || ''),
                summary: String(fields?.summary || ''),
                description: fields?.description ? JiraService.flattenAdf(fields.description) : null,
                url: `${base}/browse/${it?.key}`,
                status: fields?.status ? { name: fields.status.name } : null,
                project: fields?.project ? { key: fields.project.key, name: fields.project.name } : null,
                assignee: fields?.assignee
                    ? { displayName: fields.assignee.displayName, name: fields.assignee.name }
                    : null,
                updatedAt: fields?.updated || null,
            };
        });
    }
}
exports.default = JiraService;
