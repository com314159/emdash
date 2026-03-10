"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatCommentsForAgent = formatCommentsForAgent;
const COMMENT_LINE = (c) => {
    return `    <comment line="${c.lineNumber}">${c.content}</comment>`;
};
const FILE_BLOCK = (filePath, comments) => `  <file path="${filePath}">
${comments
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map(COMMENT_LINE)
    .join('\n')}
  </file>`;
const COMMENTS_WRAPPER = (fileBlocks) => `The user has left the following comments on the code changes:

<user_comments>
${fileBlocks.join('\n')}
</user_comments>`;
function groupByFile(comments) {
    const groups = new Map();
    for (const c of comments) {
        const existing = groups.get(c.filePath) ?? [];
        existing.push(c);
        groups.set(c.filePath, existing);
    }
    return groups;
}
function formatCommentsForAgent(comments, { includeIntro = false, leadingNewline = false } = {}) {
    if (!comments.length)
        return '';
    const byFile = groupByFile(comments);
    const fileBlocks = Array.from(byFile.entries()).map(([filePath, fileComments]) => FILE_BLOCK(filePath, fileComments));
    const prefix = leadingNewline ? '\n' : '';
    if (includeIntro) {
        return `${prefix}${COMMENTS_WRAPPER(fileBlocks)}`;
    }
    return `${prefix}<user_comments>\n${fileBlocks.join('\n')}\n</user_comments>`;
}
