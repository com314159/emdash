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
exports.skillScanPaths = exports.agentTargets = void 0;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const home = os.homedir();
/**
 * Agents that Emdash syncs skills INTO (symlinks from ~/.agentskills/).
 * Each agent has its own native directory for skills/commands.
 */
exports.agentTargets = [
    {
        id: 'claude-code',
        name: 'Claude Code',
        configDir: path.join(home, '.claude'),
        getSkillDir: (skillId) => path.join(home, '.claude', 'commands', skillId),
    },
    {
        id: 'codex',
        name: 'Codex',
        configDir: path.join(home, '.codex'),
        getSkillDir: (skillId) => path.join(home, '.codex', 'skills', skillId),
    },
    {
        id: 'opencode',
        name: 'OpenCode',
        configDir: path.join(home, '.config', 'opencode'),
        getSkillDir: (skillId) => path.join(home, '.config', 'opencode', 'skills', skillId),
    },
    {
        id: 'cursor',
        name: 'Cursor',
        configDir: path.join(home, '.cursor'),
        getSkillDir: (skillId) => path.join(home, '.cursor', 'skills', skillId),
    },
    {
        id: 'gemini',
        name: 'Gemini CLI',
        configDir: path.join(home, '.gemini'),
        getSkillDir: (skillId) => path.join(home, '.gemini', 'skills', skillId),
    },
    {
        id: 'roo-code',
        name: 'Roo Code',
        configDir: path.join(home, '.roo'),
        getSkillDir: (skillId) => path.join(home, '.roo', 'skills', skillId),
    },
    {
        id: 'mistral-vibe',
        name: 'Mistral Vibe',
        configDir: path.join(home, '.vibe'),
        getSkillDir: (skillId) => path.join(home, '.vibe', 'skills', skillId),
    },
];
/**
 * All global directories where agents store skills.
 * Derived from agentTargets (parent dir of each skill dir) plus shared/cross-agent paths.
 * Used to discover externally-installed skills (not installed through Emdash).
 */
exports.skillScanPaths = [
    // Auto-derive from agent targets (e.g. ~/.claude/commands, ~/.codex/skills)
    ...new Set(exports.agentTargets.map((t) => path.dirname(t.getSkillDir('_placeholder')))),
    // Additional paths some agents read from (not covered by targets above)
    path.join(home, '.claude', 'skills'),
    path.join(home, '.agent', 'skills'),
    path.join(home, '.agents', 'skills'),
];
