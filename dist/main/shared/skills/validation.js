"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidSkillName = isValidSkillName;
exports.parseFrontmatter = parseFrontmatter;
exports.generateSkillMd = generateSkillMd;
/** Validate a skill name: lowercase, hyphens, 1-64 chars */
function isValidSkillName(name) {
    return /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/.test(name) && !name.includes('--');
}
/** Parse YAML frontmatter from SKILL.md content */
function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
        return {
            frontmatter: { name: '', description: '' },
            body: content,
        };
    }
    const yamlBlock = match[1];
    const body = match[2];
    const frontmatter = {};
    for (const line of yamlBlock.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1)
            continue;
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        const wasDoubleQuoted = value.startsWith('"') && value.endsWith('"');
        const wasSingleQuoted = value.startsWith("'") && value.endsWith("'");
        if (wasDoubleQuoted || wasSingleQuoted) {
            value = value.slice(1, -1);
            if (wasDoubleQuoted) {
                value = value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            }
            else if (wasSingleQuoted) {
                value = value.replace(/''/g, "'");
            }
        }
        if (key) {
            frontmatter[key] = value;
        }
    }
    return {
        frontmatter: {
            name: frontmatter['name'] || '',
            description: frontmatter['description'] || '',
            license: frontmatter['license'],
            compatibility: frontmatter['compatibility'],
            'allowed-tools': frontmatter['allowed-tools'],
        },
        body,
    };
}
function escapeYamlDoubleQuoted(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
function generateSkillMd(name, description, body) {
    const escapedName = escapeYamlDoubleQuoted(name);
    const escapedDesc = escapeYamlDoubleQuoted(description);
    const defaultBody = `# ${name}\n\n${description}\n`;
    const content = body && body.trim() ? body.trim() : defaultBody;
    return `---
name: "${escapedName}"
description: "${escapedDesc}"
---

${content}
`;
}
