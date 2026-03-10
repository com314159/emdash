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
exports.skillsService = exports.SkillsService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const https = __importStar(require("https"));
const logger_1 = require("../lib/logger");
const validation_1 = require("@shared/skills/validation");
const agentTargets_1 = require("@shared/skills/agentTargets");
const SKILLS_ROOT = path.join(os.homedir(), '.agentskills');
const EMDASH_META = path.join(SKILLS_ROOT, '.emdash');
const CATALOG_INDEX_PATH = path.join(EMDASH_META, 'catalog-index.json');
const MAX_REDIRECTS = 5;
function httpsGet(url, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${url}`));
            return;
        }
        const req = https.get(url, { headers: { 'User-Agent': 'emdash-skills', Accept: 'application/vnd.github.v3+json' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                const location = res.headers.location;
                if (location) {
                    const resolved = new URL(location, url).href;
                    httpsGet(resolved, redirectCount + 1).then(resolve, reject);
                    return;
                }
            }
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy(new Error('Request timed out'));
        });
    });
}
class SkillsService {
    constructor() {
        this.catalogCache = null;
    }
    async initialize() {
        await fs.promises.mkdir(SKILLS_ROOT, { recursive: true });
        await fs.promises.mkdir(EMDASH_META, { recursive: true });
    }
    async getCatalogIndex() {
        if (this.catalogCache) {
            return this.mergeInstalledState(this.catalogCache);
        }
        // Try disk cache — only use if its version matches current
        try {
            const data = await fs.promises.readFile(CATALOG_INDEX_PATH, 'utf-8');
            const diskCache = JSON.parse(data);
            if (diskCache.version >= SkillsService.CATALOG_VERSION) {
                this.catalogCache = diskCache;
                return this.mergeInstalledState(this.catalogCache);
            }
            // Stale disk cache — fall through to bundled
        }
        catch {
            // No disk cache — fall back to bundled catalog
        }
        const bundled = await this.loadBundledCatalog();
        this.catalogCache = bundled;
        return this.mergeInstalledState(bundled);
    }
    async refreshCatalog() {
        try {
            const [openaiSkills, anthropicSkills] = await Promise.allSettled([
                this.fetchOpenAICatalog(),
                this.fetchAnthropicCatalog(),
            ]);
            const allSkills = [];
            if (openaiSkills.status === 'fulfilled') {
                allSkills.push(...openaiSkills.value);
            }
            if (anthropicSkills.status === 'fulfilled') {
                allSkills.push(...anthropicSkills.value);
            }
            // Deduplicate by id — first occurrence wins
            const seen = new Set();
            const skills = allSkills.filter((s) => {
                if (seen.has(s.id))
                    return false;
                seen.add(s.id);
                return true;
            });
            // If both failed, fall back to bundled
            if (skills.length === 0) {
                logger_1.log.warn('Failed to fetch any remote catalogs, using bundled');
                return this.getCatalogIndex();
            }
            const catalog = {
                version: SkillsService.CATALOG_VERSION,
                lastUpdated: new Date().toISOString(),
                skills,
            };
            this.catalogCache = catalog;
            await fs.promises.writeFile(CATALOG_INDEX_PATH, JSON.stringify(catalog, null, 2));
            return this.mergeInstalledState(catalog);
        }
        catch (error) {
            logger_1.log.error('Failed to refresh catalog:', error);
            return this.getCatalogIndex();
        }
    }
    async getInstalledSkills() {
        await this.initialize();
        const seen = new Set();
        const skills = [];
        // Scan all known skill directories (central + agent-specific)
        const dirsToScan = [SKILLS_ROOT, ...agentTargets_1.skillScanPaths];
        for (const dir of dirsToScan) {
            let entries;
            try {
                entries = await fs.promises.readdir(dir, { withFileTypes: true });
            }
            catch {
                continue; // Directory doesn't exist
            }
            for (const entry of entries) {
                if (entry.name.startsWith('.'))
                    continue;
                if (!entry.isDirectory() && !entry.isSymbolicLink())
                    continue;
                if (seen.has(entry.name))
                    continue; // Already found this skill
                let skillDir = path.join(dir, entry.name);
                // Resolve symlinks to get the real path and verify it's a directory
                try {
                    const realPath = await fs.promises.realpath(skillDir);
                    const stat = await fs.promises.stat(realPath);
                    if (!stat.isDirectory())
                        continue;
                    skillDir = realPath;
                }
                catch (err) {
                    logger_1.log.warn(`Skipping skill "${entry.name}" in ${dir}: failed to resolve path`, err);
                    continue;
                }
                const skillMdPath = path.join(skillDir, 'SKILL.md');
                try {
                    const content = await fs.promises.readFile(skillMdPath, 'utf-8');
                    const { frontmatter } = (0, validation_1.parseFrontmatter)(content);
                    seen.add(entry.name);
                    skills.push({
                        id: entry.name,
                        displayName: frontmatter.name || entry.name,
                        description: frontmatter.description || '',
                        source: 'local',
                        frontmatter,
                        installed: true,
                        localPath: skillDir,
                        skillMdContent: content,
                    });
                }
                catch {
                    // No SKILL.md — not a valid skill directory, skip silently
                }
            }
        }
        return skills;
    }
    async getSkillDetail(skillId) {
        const catalog = await this.getCatalogIndex();
        const skill = catalog.skills.find((s) => s.id === skillId);
        if (!skill)
            return null;
        // If installed, load the full SKILL.md from disk
        if (skill.installed && skill.localPath) {
            try {
                const content = await fs.promises.readFile(path.join(skill.localPath, 'SKILL.md'), 'utf-8');
                return { ...skill, skillMdContent: content };
            }
            catch {
                // Return what we have
            }
        }
        // For uninstalled catalog skills, fetch SKILL.md from GitHub
        if (!skill.installed && !skill.skillMdContent) {
            try {
                const mdUrl = this.getSkillMdUrl(skill);
                if (mdUrl) {
                    const content = await httpsGet(mdUrl);
                    return { ...skill, skillMdContent: content };
                }
            }
            catch {
                // Return what we have
            }
        }
        return skill;
    }
    getSkillMdUrl(skill) {
        if (skill.source === 'openai' && skill.sourceUrl) {
            // e.g. https://github.com/openai/skills/tree/main/skills/.curated/linear
            // → https://raw.githubusercontent.com/openai/skills/main/skills/.curated/linear/SKILL.md
            const match = skill.sourceUrl.match(/github\.com\/([^/]+\/[^/]+)\/tree\/main\/(.+)/);
            if (match) {
                return `https://raw.githubusercontent.com/${match[1]}/main/${match[2]}/SKILL.md`;
            }
        }
        if (skill.source === 'anthropic' && skill.sourceUrl) {
            const match = skill.sourceUrl.match(/github\.com\/([^/]+\/[^/]+)\/tree\/main\/(.+)/);
            if (match) {
                return `https://raw.githubusercontent.com/${match[1]}/main/${match[2]}/SKILL.md`;
            }
        }
        return null;
    }
    async installSkill(skillId) {
        await this.initialize();
        const catalog = await this.getCatalogIndex();
        const skill = catalog.skills.find((s) => s.id === skillId);
        if (!skill)
            throw new Error(`Skill "${skillId}" not found in catalog`);
        if (skill.installed)
            throw new Error(`Skill "${skillId}" is already installed`);
        const skillDir = path.join(SKILLS_ROOT, skillId);
        const tmpDir = `${skillDir}.tmp-${Date.now()}`;
        try {
            await fs.promises.mkdir(tmpDir, { recursive: true });
            // Try to download the real SKILL.md from GitHub; fall back to generated stub
            let content;
            try {
                const mdUrl = this.getSkillMdUrl(skill);
                if (mdUrl) {
                    content = await httpsGet(mdUrl);
                }
                else {
                    content = (0, validation_1.generateSkillMd)(skill.displayName, skill.description);
                }
            }
            catch {
                content = (0, validation_1.generateSkillMd)(skill.displayName, skill.description);
            }
            await fs.promises.writeFile(path.join(tmpDir, 'SKILL.md'), content);
            // Remove stale target dir if present (e.g. from a previous failed install)
            await fs.promises.rm(skillDir, { recursive: true, force: true }).catch(() => { });
            // Atomic move: rename tmp dir to final location
            await fs.promises.rename(tmpDir, skillDir);
            // Sync to agents
            await this.syncToAgents(skillId);
            // Invalidate cache
            this.catalogCache = null;
            return {
                ...skill,
                installed: true,
                localPath: skillDir,
                skillMdContent: content,
            };
        }
        catch (error) {
            // Clean up partial install
            await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
            await fs.promises.rm(skillDir, { recursive: true, force: true }).catch(() => { });
            throw error;
        }
    }
    async uninstallSkill(skillId) {
        const skillDir = path.join(SKILLS_ROOT, skillId);
        // Remove agent symlinks first
        await this.unsyncFromAgents(skillId);
        // Remove skill directory
        try {
            await fs.promises.rm(skillDir, { recursive: true, force: true });
        }
        catch (error) {
            logger_1.log.error(`Failed to remove skill directory ${skillDir}:`, error);
            throw error;
        }
        // Invalidate cache
        this.catalogCache = null;
    }
    async createSkill(name, description, content) {
        if (!(0, validation_1.isValidSkillName)(name)) {
            throw new Error('Invalid skill name. Use lowercase letters, numbers, and hyphens (1-64 chars).');
        }
        await this.initialize();
        const skillDir = path.join(SKILLS_ROOT, name);
        try {
            await fs.promises.access(skillDir);
            throw new Error(`Skill "${name}" already exists`);
        }
        catch (err) {
            if (err.code !== 'ENOENT')
                throw err;
        }
        await fs.promises.mkdir(skillDir, { recursive: true });
        const skillContent = (0, validation_1.generateSkillMd)(name, description, content?.trim());
        await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), skillContent);
        // Sync to agents
        await this.syncToAgents(name);
        // Invalidate cache
        this.catalogCache = null;
        const { frontmatter } = (0, validation_1.parseFrontmatter)(skillContent);
        return {
            id: name,
            displayName: name,
            description,
            source: 'local',
            frontmatter,
            installed: true,
            localPath: skillDir,
            skillMdContent: skillContent,
        };
    }
    async syncToAgents(skillId) {
        const skillDir = path.join(SKILLS_ROOT, skillId);
        for (const target of agentTargets_1.agentTargets) {
            try {
                // Only sync if the agent's config dir exists (agent is installed)
                await fs.promises.access(target.configDir);
                const targetDir = target.getSkillDir(skillId);
                const parentDir = path.dirname(targetDir);
                await fs.promises.mkdir(parentDir, { recursive: true });
                // Remove existing symlink/dir if present
                try {
                    const stat = await fs.promises.lstat(targetDir);
                    if (stat.isSymbolicLink() || stat.isDirectory()) {
                        await fs.promises.rm(targetDir, { recursive: true, force: true });
                    }
                }
                catch {
                    // Doesn't exist, that's fine
                }
                await fs.promises.symlink(skillDir, targetDir, 'junction');
            }
            catch (err) {
                // Agent not installed — expected; log unexpected failures
                const code = err.code;
                if (code !== 'ENOENT') {
                    logger_1.log.warn(`Failed to sync skill "${skillId}" to ${target.name}:`, err);
                }
            }
        }
    }
    async unsyncFromAgents(skillId) {
        for (const target of agentTargets_1.agentTargets) {
            try {
                const targetDir = target.getSkillDir(skillId);
                const stat = await fs.promises.lstat(targetDir);
                if (stat.isSymbolicLink()) {
                    // Only remove symlinks that point into our central skills root
                    const linkTarget = await fs.promises.readlink(targetDir);
                    const resolved = path.resolve(path.dirname(targetDir), linkTarget);
                    if (resolved.startsWith(SKILLS_ROOT)) {
                        await fs.promises.unlink(targetDir);
                    }
                }
                // Never rm -rf real directories in agent config — they may be user-managed
            }
            catch {
                // Doesn't exist or can't remove — skip
            }
        }
    }
    async getDetectedAgents() {
        const agents = [];
        for (const target of agentTargets_1.agentTargets) {
            let installed = false;
            try {
                await fs.promises.access(target.configDir);
                installed = true;
            }
            catch {
                // Not installed
            }
            agents.push({
                id: target.id,
                name: target.name,
                configDir: target.configDir,
                installed,
            });
        }
        return agents;
    }
    // --- Private helpers ---
    async loadBundledCatalog() {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const bundled = require('./skills/bundled-catalog.json');
            return bundled;
        }
        catch {
            return { version: 1, lastUpdated: new Date().toISOString(), skills: [] };
        }
    }
    async mergeInstalledState(catalog) {
        const installed = await this.getInstalledSkills();
        const installedMap = new Map(installed.map((s) => [s.id, s]));
        // Deduplicate catalog skills by id (first occurrence wins)
        const seen = new Set();
        const dedupedSkills = catalog.skills.filter((s) => {
            if (seen.has(s.id))
                return false;
            seen.add(s.id);
            return true;
        });
        const mergedSkills = dedupedSkills.map((skill) => {
            const local = installedMap.get(skill.id);
            if (local) {
                installedMap.delete(skill.id);
                return {
                    ...skill,
                    installed: true,
                    localPath: local.localPath,
                    skillMdContent: local.skillMdContent,
                };
            }
            return { ...skill, installed: false };
        });
        // Add locally-installed skills not in the catalog
        for (const local of installedMap.values()) {
            mergedSkills.push(local);
        }
        return { ...catalog, skills: mergedSkills };
    }
    async fetchOpenAICatalog() {
        const baseUrl = 'https://api.github.com/repos/openai/skills/contents/skills';
        const rawBase = 'https://raw.githubusercontent.com/openai/skills/main/skills';
        // Fetch both curated and system skills
        const [curatedData, systemData] = await Promise.all([
            httpsGet(`${baseUrl}/.curated`),
            httpsGet(`${baseUrl}/.system`).catch(() => '[]'),
        ]);
        const curatedEntries = JSON.parse(curatedData);
        const systemEntries = JSON.parse(systemData);
        const allEntries = [
            ...curatedEntries.map((e) => ({ ...e, category: '.curated' })),
            ...systemEntries.map((e) => ({ ...e, category: '.system' })),
        ].filter((e) => e.type === 'dir');
        // Fetch openai.yaml for each skill in parallel (with fallback)
        const skills = await Promise.all(allEntries.map(async (entry) => {
            const fallbackName = entry.name
                .split('-')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');
            let displayName = fallbackName;
            let description = '';
            let iconUrl;
            let brandColor;
            let defaultPrompt;
            try {
                const yamlUrl = `${rawBase}/${entry.category}/${entry.name}/agents/openai.yaml`;
                const yamlContent = await httpsGet(yamlUrl);
                const parsed = this.parseSimpleYaml(yamlContent);
                displayName = parsed['display_name'] || fallbackName;
                description = parsed['short_description'] || '';
                defaultPrompt = parsed['default_prompt'];
                brandColor = parsed['brand_color'];
                // Resolve icon URL from relative path
                const iconPath = parsed['icon_small'] || parsed['icon_large'];
                if (iconPath) {
                    const cleanPath = iconPath.replace(/^\.\//, '');
                    iconUrl = `${rawBase}/${entry.category}/${entry.name}/${cleanPath}`;
                }
            }
            catch {
                // No openai.yaml — use fallback
            }
            // If still no description, try fetching SKILL.md frontmatter
            if (!description) {
                try {
                    const mdUrl = `${rawBase}/${entry.category}/${entry.name}/SKILL.md`;
                    const md = await httpsGet(mdUrl);
                    const { frontmatter: fm } = (0, validation_1.parseFrontmatter)(md);
                    if (fm.description)
                        description = fm.description;
                }
                catch {
                    // Use empty string
                }
            }
            if (!description) {
                description = `${entry.name.replace(/-/g, ' ')}`;
            }
            const skill = {
                id: entry.name,
                displayName,
                description,
                source: 'openai',
                sourceUrl: entry.html_url,
                iconUrl,
                brandColor: brandColor || '#10a37f',
                defaultPrompt,
                frontmatter: { name: entry.name, description },
                installed: false,
            };
            return skill;
        }));
        return skills;
    }
    async fetchAnthropicCatalog() {
        const url = 'https://api.github.com/repos/anthropics/skills/contents/skills';
        const rawBase = 'https://raw.githubusercontent.com/anthropics/skills/main/skills';
        const data = await httpsGet(url);
        const entries = JSON.parse(data);
        const skills = [];
        for (const entry of entries) {
            if (entry.type !== 'dir')
                continue;
            const fallbackName = entry.name
                .split('-')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');
            let description = '';
            // Try to get description from SKILL.md frontmatter
            try {
                const mdUrl = `${rawBase}/${entry.name}/SKILL.md`;
                const md = await httpsGet(mdUrl);
                const { frontmatter: fm } = (0, validation_1.parseFrontmatter)(md);
                if (fm.description)
                    description = fm.description;
            }
            catch {
                // Use fallback
            }
            if (!description) {
                description = `${entry.name.replace(/-/g, ' ')}`;
            }
            skills.push({
                id: entry.name,
                displayName: fallbackName,
                description,
                source: 'anthropic',
                sourceUrl: entry.html_url,
                brandColor: '#d4a574',
                frontmatter: { name: entry.name, description },
                installed: false,
            });
        }
        return skills;
    }
    /** Minimal YAML parser for openai.yaml interface block */
    parseSimpleYaml(content) {
        const result = {};
        for (const line of content.split('\n')) {
            const match = line.match(/^\s+(\w+):\s*"?([^"]*)"?\s*$/);
            if (match) {
                result[match[1]] = match[2].trim();
            }
        }
        return result;
    }
}
exports.SkillsService = SkillsService;
SkillsService.CATALOG_VERSION = 2;
exports.skillsService = new SkillsService();
