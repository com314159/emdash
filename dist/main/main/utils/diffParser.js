"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DIFF_OUTPUT_BYTES = exports.MAX_DIFF_CONTENT_BYTES = void 0;
exports.stripTrailingNewline = stripTrailingNewline;
exports.parseDiffLines = parseDiffLines;
exports.detectLineEndingStyle = detectLineEndingStyle;
exports.buildDiffWarnings = buildDiffWarnings;
/** Maximum bytes for fetching file content in diffs. */
exports.MAX_DIFF_CONTENT_BYTES = 512 * 1024;
/** Maximum bytes for `git diff` output (larger than content limit due to headers/context). */
exports.MAX_DIFF_OUTPUT_BYTES = 10 * 1024 * 1024;
const DIFF_METADATA_PREFIXES = [
    'diff --git ',
    'index ',
    '--- ',
    '+++ ',
    'new file mode ',
    'old file mode ',
    'new mode ',
    'old mode ',
    'deleted file mode ',
    'similarity index ',
    'dissimilarity index ',
    'rename from ',
    'rename to ',
    'copy from ',
    'copy to ',
    'Binary files ',
    'GIT binary patch',
    'literal ',
    'delta ',
];
const NO_NEWLINE_MARKER = '\\ No newline at end of file';
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?:.*)?$/;
const HIDDEN_BIDI_CHARS_RE = /[\u202A-\u202E\u2066-\u2069]/;
/** Strip exactly one trailing newline, if present. */
function stripTrailingNewline(s) {
    return s.endsWith('\n') ? s.slice(0, -1) : s;
}
function isDiffMetadataLine(line) {
    return DIFF_METADATA_PREFIXES.some((prefix) => line.startsWith(prefix));
}
/** Parse raw `git diff` output into structured diff lines, with resilient hunk-state parsing. */
function parseDiffLines(stdout) {
    const result = [];
    let isBinary = false;
    let inHunk = false;
    let hasHunk = false;
    for (const line of stdout.split('\n')) {
        if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
            isBinary = true;
            inHunk = false;
            continue;
        }
        if (HUNK_HEADER_RE.test(line)) {
            inHunk = true;
            hasHunk = true;
            continue;
        }
        if (line.startsWith('diff --git ')) {
            inHunk = false;
            continue;
        }
        if (inHunk) {
            if (line === NO_NEWLINE_MARKER) {
                continue;
            }
            const prefix = line[0];
            const content = line.slice(1);
            if (prefix === ' ') {
                result.push({ left: content, right: content, type: 'context' });
                continue;
            }
            if (prefix === '-') {
                result.push({ left: content, type: 'del' });
                continue;
            }
            if (prefix === '+') {
                result.push({ right: content, type: 'add' });
                continue;
            }
            if (prefix === '\\') {
                continue;
            }
        }
        if (!line || isDiffMetadataLine(line)) {
            continue;
        }
        result.push({ left: line, right: line, type: 'context' });
    }
    if (!isBinary && result.length === 0 && stdout.includes('Binary files')) {
        isBinary = true;
    }
    return { lines: result, isBinary, hasHunk };
}
function containsHiddenBidi(text) {
    return typeof text === 'string' && HIDDEN_BIDI_CHARS_RE.test(text);
}
function detectLineEndingStyle(text) {
    if (typeof text !== 'string' || text.length === 0)
        return 'none';
    let hasLf = false;
    let hasCrLf = false;
    let hasCr = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '\r') {
            if (text[i + 1] === '\n') {
                hasCrLf = true;
                i++;
            }
            else {
                hasCr = true;
            }
            continue;
        }
        if (char === '\n') {
            hasLf = true;
        }
    }
    const kinds = Number(hasLf) + Number(hasCrLf) + Number(hasCr);
    if (kinds > 1)
        return 'mixed';
    if (hasCrLf)
        return 'crlf';
    if (hasLf)
        return 'lf';
    if (hasCr)
        return 'cr';
    return 'none';
}
function buildDiffWarnings(args) {
    const warnings = [];
    const { originalContent, modifiedContent, lines = [] } = args;
    let hasHiddenBidi = containsHiddenBidi(originalContent) || containsHiddenBidi(modifiedContent);
    if (!hasHiddenBidi) {
        hasHiddenBidi = lines.some((line) => containsHiddenBidi(line.left) || containsHiddenBidi(line.right));
    }
    if (hasHiddenBidi) {
        warnings.push({ kind: 'hidden-bidi' });
    }
    if (originalContent !== undefined && modifiedContent !== undefined) {
        const from = detectLineEndingStyle(originalContent);
        const to = detectLineEndingStyle(modifiedContent);
        if (from !== to && (from !== 'none' || to !== 'none')) {
            warnings.push({ kind: 'line-endings-change', from, to });
        }
    }
    return warnings;
}
