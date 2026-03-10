"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mcpService = exports.McpService = void 0;
const logger_1 = require("../lib/logger");
const configIO_1 = require("./mcp/configIO");
const configPaths_1 = require("./mcp/configPaths");
const adapters_1 = require("./mcp/adapters");
const catalog_1 = require("./mcp/catalog");
class McpService {
    constructor() {
        this._writeLock = Promise.resolve();
    }
    async withWriteLock(fn) {
        const prev = this._writeLock;
        let resolve;
        this._writeLock = new Promise((r) => {
            resolve = r;
        });
        await prev;
        try {
            return await fn();
        }
        finally {
            resolve();
        }
    }
    async loadAll() {
        return this.withWriteLock(async () => {
            const agentIds = (0, configPaths_1.getAllMcpAgentIds)();
            const serversByName = new Map();
            for (const agentId of agentIds) {
                const meta = (0, configPaths_1.getAgentMcpMeta)(agentId);
                if (!meta)
                    continue;
                let rawServers;
                try {
                    rawServers = await (0, configIO_1.readServers)(meta);
                }
                catch (err) {
                    logger_1.log.warn(`Failed to read MCP config for ${agentId}:`, err);
                    continue;
                }
                // Reverse-adapt to canonical raw format
                const canonical = (0, adapters_1.adaptReverse)(meta.adapter, rawServers);
                for (const [name, raw] of Object.entries(canonical)) {
                    const existing = serversByName.get(name);
                    if (existing) {
                        existing.providers.add(agentId);
                        // Keep richest config (more keys = richer)
                        const newServer = rawToMcpServer(name, raw, existing.providers);
                        const existingKeyCount = Object.keys(rawEntryToMcpFields(existing.server)).length;
                        const newKeyCount = Object.keys(rawEntryToMcpFields(newServer)).length;
                        if (newKeyCount > existingKeyCount) {
                            existing.server = newServer;
                        }
                    }
                    else {
                        const providers = new Set([agentId]);
                        serversByName.set(name, {
                            server: rawToMcpServer(name, raw, providers),
                            providers,
                        });
                    }
                }
            }
            const installed = [];
            for (const { server, providers } of serversByName.values()) {
                server.providers = Array.from(providers);
                installed.push(server);
            }
            const catalog = (0, catalog_1.loadCatalog)();
            return { installed, catalog };
        });
    }
    async saveServer(server) {
        if (!server.name || !/^[\w\-._]+$/.test(server.name)) {
            throw new Error(`Invalid server name: "${server.name}"`);
        }
        return this.withWriteLock(async () => {
            const allAgentIds = (0, configPaths_1.getAllMcpAgentIds)();
            const selectedProviders = new Set(server.providers);
            const raw = mcpServerToRaw(server);
            const failures = [];
            for (const agentId of allAgentIds) {
                const meta = (0, configPaths_1.getAgentMcpMeta)(agentId);
                if (!meta)
                    continue;
                let existing;
                try {
                    existing = await (0, configIO_1.readServers)(meta);
                }
                catch {
                    existing = {};
                }
                if (selectedProviders.has(agentId)) {
                    // Add/update: forward-adapt the single server and merge into existing
                    const adapted = (0, adapters_1.adaptForward)(meta.adapter, { [server.name]: raw });
                    const adaptedEntry = adapted[server.name];
                    if (adaptedEntry) {
                        existing[server.name] = adaptedEntry;
                    }
                }
                else if (server.name in existing) {
                    // Remove from deselected provider
                    delete existing[server.name];
                }
                else {
                    continue; // no change needed
                }
                try {
                    await (0, configIO_1.writeServers)(meta, existing);
                }
                catch (err) {
                    logger_1.log.error(`Failed to write MCP config for ${agentId}:`, err);
                    failures.push(agentId);
                }
            }
            if (failures.length) {
                throw new Error(`Failed to write config for: ${failures.join(', ')}`);
            }
        });
    }
    async removeServer(serverName) {
        return this.withWriteLock(async () => {
            const allAgentIds = (0, configPaths_1.getAllMcpAgentIds)();
            const failures = [];
            for (const agentId of allAgentIds) {
                const meta = (0, configPaths_1.getAgentMcpMeta)(agentId);
                if (!meta)
                    continue;
                let existing;
                try {
                    existing = await (0, configIO_1.readServers)(meta);
                }
                catch {
                    continue;
                }
                if (!(serverName in existing))
                    continue;
                delete existing[serverName];
                try {
                    await (0, configIO_1.writeServers)(meta, existing);
                }
                catch (err) {
                    logger_1.log.error(`Failed to write MCP config for ${agentId}:`, err);
                    failures.push(agentId);
                }
            }
            if (failures.length) {
                throw new Error(`Failed to write config for: ${failures.join(', ')}`);
            }
        });
    }
}
exports.McpService = McpService;
// ── Conversion helpers ─────────────────────────────────────────────────────
function rawToMcpServer(name, raw, providers) {
    const isHttp = raw.type === 'http' || ('url' in raw && !('command' in raw));
    return {
        name,
        transport: isHttp ? 'http' : 'stdio',
        command: typeof raw.command === 'string' ? raw.command : undefined,
        args: Array.isArray(raw.args) ? raw.args : undefined,
        url: typeof raw.url === 'string' ? raw.url : undefined,
        headers: typeof raw.headers === 'object' && raw.headers !== null
            ? raw.headers
            : undefined,
        env: typeof raw.env === 'object' && raw.env !== null
            ? raw.env
            : undefined,
        providers: Array.from(providers),
    };
}
function mcpServerToRaw(server) {
    const raw = {};
    if (server.transport === 'http') {
        raw.type = 'http';
        if (server.url)
            raw.url = server.url;
        if (server.headers && Object.keys(server.headers).length)
            raw.headers = server.headers;
    }
    else {
        if (server.command)
            raw.command = server.command;
        if (server.args?.length)
            raw.args = server.args;
    }
    if (server.env && Object.keys(server.env).length)
        raw.env = server.env;
    return raw;
}
function rawEntryToMcpFields(server) {
    const fields = {};
    if (server.command)
        fields.command = server.command;
    if (server.args?.length)
        fields.args = server.args;
    if (server.url)
        fields.url = server.url;
    if (server.headers)
        fields.headers = server.headers;
    if (server.env)
        fields.env = server.env;
    return fields;
}
exports.mcpService = new McpService();
