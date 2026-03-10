"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAgentMcpMeta = getAgentMcpMeta;
exports.getAllMcpAgentIds = getAllMcpAgentIds;
exports.agentSupportsHttp = agentSupportsHttp;
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const AGENT_CONFIGS = {
    claude: {
        pathSegments: ['.claude.json'],
        serversPath: ['mcpServers'],
        template: { mcpServers: {} },
        isToml: false,
        adapter: 'passthrough',
        supportsHttp: true,
    },
    cursor: {
        pathSegments: ['.cursor', 'mcp.json'],
        serversPath: ['mcpServers'],
        template: { mcpServers: {} },
        isToml: false,
        adapter: 'cursor',
        supportsHttp: true,
    },
    codex: {
        pathSegments: ['.codex', 'config.toml'],
        serversPath: ['mcp_servers'],
        template: { mcp_servers: {} },
        isToml: true,
        adapter: 'codex',
        supportsHttp: false,
    },
    amp: {
        pathSegments: ['.config', 'amp', 'settings.json'],
        serversPath: ['mcpServers'],
        template: { mcpServers: {} },
        isToml: false,
        adapter: 'passthrough',
        supportsHttp: true,
    },
    gemini: {
        pathSegments: ['.gemini', 'settings.json'],
        serversPath: ['mcpServers'],
        template: { mcpServers: {} },
        isToml: false,
        adapter: 'gemini',
        supportsHttp: true,
    },
    qwen: {
        pathSegments: ['.qwen', 'settings.json'],
        serversPath: ['mcpServers'],
        template: { mcpServers: {} },
        isToml: false,
        adapter: 'gemini',
        supportsHttp: true,
    },
    opencode: {
        pathSegments: ['.config', 'opencode', 'opencode.json'],
        serversPath: ['mcp'],
        template: { mcp: {} },
        isToml: false,
        adapter: 'opencode',
        supportsHttp: true,
    },
    copilot: {
        pathSegments: ['.copilot', 'mcp-config.json'],
        serversPath: ['mcpServers'],
        template: { mcpServers: {} },
        isToml: false,
        adapter: 'copilot',
        supportsHttp: true,
    },
    droid: {
        pathSegments: ['.droid', 'settings.json'],
        serversPath: ['mcpServers'],
        template: { mcpServers: {} },
        isToml: false,
        adapter: 'passthrough',
        supportsHttp: true,
    },
};
function getAgentMcpMeta(agentId) {
    const def = AGENT_CONFIGS[agentId];
    if (!def)
        return undefined;
    const home = os_1.default.homedir();
    return {
        agentId,
        configPath: path_1.default.join(home, ...def.pathSegments),
        serversPath: def.serversPath,
        template: def.template,
        isToml: def.isToml,
        adapter: def.adapter,
    };
}
function getAllMcpAgentIds() {
    return Object.keys(AGENT_CONFIGS);
}
function agentSupportsHttp(agentId) {
    return AGENT_CONFIGS[agentId]?.supportsHttp ?? true;
}
