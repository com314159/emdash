"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.injectIssueFooter = injectIssueFooter;
const START_MARKER = '<!-- emdash-issue-footer:start -->';
const END_MARKER = '<!-- emdash-issue-footer:end -->';
const ISSUE_FOOTER_BLOCK_RE = /\n?<!-- emdash-issue-footer:start -->[\s\S]*?<!-- emdash-issue-footer:end -->\n?/g;
function stripInjectedIssueFooter(body) {
    return body.replace(ISSUE_FOOTER_BLOCK_RE, '').trimEnd();
}
function getFixesLines(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return [];
    }
    const md = metadata;
    const lines = [];
    const ghNumberRaw = md.githubIssue?.number;
    const ghNumber = typeof ghNumberRaw === 'number'
        ? ghNumberRaw
        : typeof ghNumberRaw === 'string'
            ? Number.parseInt(ghNumberRaw, 10)
            : NaN;
    if (Number.isFinite(ghNumber) && ghNumber > 0) {
        lines.push(`Fixes #${ghNumber}`);
    }
    const linearIdentifier = typeof md.linearIssue?.identifier === 'string' ? md.linearIssue.identifier.trim() : '';
    if (linearIdentifier) {
        lines.push(`Fixes ${linearIdentifier}`);
    }
    return Array.from(new Set(lines));
}
function injectIssueFooter(body, metadata) {
    const cleaned = stripInjectedIssueFooter(typeof body === 'string' ? body : '');
    const lines = getFixesLines(metadata);
    if (lines.length === 0) {
        const trimmed = cleaned.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    const footerBlock = [START_MARKER, ...lines, END_MARKER].join('\n');
    const separator = cleaned.trim().length > 0 ? '\n\n' : '';
    const combined = `${cleaned}${separator}${footerBlock}`.trim();
    return combined.length > 0 ? combined : undefined;
}
