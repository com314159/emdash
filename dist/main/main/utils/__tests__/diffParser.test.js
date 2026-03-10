"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const diffParser_1 = require("../diffParser");
(0, vitest_1.describe)('parseDiffLines', () => {
    (0, vitest_1.it)('should parse a standard unified diff', () => {
        const stdout = 'diff --git a/file.ts b/file.ts\n' +
            'index abc..def 100644\n' +
            '--- a/file.ts\n' +
            '+++ b/file.ts\n' +
            '@@ -1,3 +1,3 @@\n' +
            ' hello\n' +
            '-old line\n' +
            '+new line\n' +
            ' world\n';
        const { lines, isBinary } = (0, diffParser_1.parseDiffLines)(stdout);
        (0, vitest_1.expect)(isBinary).toBe(false);
        (0, vitest_1.expect)(lines).toEqual([
            { left: 'hello', right: 'hello', type: 'context' },
            { left: 'old line', type: 'del' },
            { right: 'new line', type: 'add' },
            { left: 'world', right: 'world', type: 'context' },
        ]);
    });
    (0, vitest_1.it)('should skip all extended diff headers', () => {
        const stdout = 'diff --git a/file.ts b/file.ts\n' +
            'new file mode 100644\n' +
            'old file mode 100755\n' +
            'deleted file mode 100644\n' +
            'similarity index 95%\n' +
            'rename from old.ts\n' +
            'rename to new.ts\n' +
            'index abc..def 100644\n' +
            '--- a/file.ts\n' +
            '+++ b/file.ts\n' +
            '@@ -1 +1 @@\n' +
            '+content\n';
        const { lines } = (0, diffParser_1.parseDiffLines)(stdout);
        (0, vitest_1.expect)(lines).toEqual([{ right: 'content', type: 'add' }]);
    });
    (0, vitest_1.it)('should skip "No newline at end of file" markers', () => {
        const stdout = 'diff --git a/f b/f\n' +
            '--- a/f\n' +
            '+++ b/f\n' +
            '@@ -1 +1 @@\n' +
            '-old\n' +
            '\\ No newline at end of file\n' +
            '+new\n' +
            '\\ No newline at end of file\n';
        const { lines } = (0, diffParser_1.parseDiffLines)(stdout);
        (0, vitest_1.expect)(lines).toEqual([
            { left: 'old', type: 'del' },
            { right: 'new', type: 'add' },
        ]);
    });
    (0, vitest_1.it)('should detect binary files', () => {
        const stdout = 'diff --git a/img.png b/img.png\n' +
            'index abc..def 100644\n' +
            'Binary files a/img.png and b/img.png differ\n';
        const { lines, isBinary } = (0, diffParser_1.parseDiffLines)(stdout);
        (0, vitest_1.expect)(isBinary).toBe(true);
        (0, vitest_1.expect)(lines).toEqual([]);
    });
    (0, vitest_1.it)('should return empty for empty input', () => {
        const { lines, isBinary } = (0, diffParser_1.parseDiffLines)('');
        (0, vitest_1.expect)(lines).toEqual([]);
        (0, vitest_1.expect)(isBinary).toBe(false);
    });
    (0, vitest_1.it)('should treat unrecognized prefix lines as context with full line', () => {
        const { lines } = (0, diffParser_1.parseDiffLines)('some unexpected line\n');
        (0, vitest_1.expect)(lines).toEqual([
            { left: 'some unexpected line', right: 'some unexpected line', type: 'context' },
        ]);
    });
});
(0, vitest_1.describe)('stripTrailingNewline', () => {
    (0, vitest_1.it)('should strip one trailing newline', () => {
        (0, vitest_1.expect)((0, diffParser_1.stripTrailingNewline)('hello\n')).toBe('hello');
    });
    (0, vitest_1.it)('should strip only one trailing newline', () => {
        (0, vitest_1.expect)((0, diffParser_1.stripTrailingNewline)('hello\n\n')).toBe('hello\n');
    });
    (0, vitest_1.it)('should return unchanged if no trailing newline', () => {
        (0, vitest_1.expect)((0, diffParser_1.stripTrailingNewline)('hello')).toBe('hello');
    });
    (0, vitest_1.it)('should handle empty string', () => {
        (0, vitest_1.expect)((0, diffParser_1.stripTrailingNewline)('')).toBe('');
    });
});
(0, vitest_1.describe)('MAX_DIFF_CONTENT_BYTES', () => {
    (0, vitest_1.it)('should be 512KB', () => {
        (0, vitest_1.expect)(diffParser_1.MAX_DIFF_CONTENT_BYTES).toBe(512 * 1024);
    });
});
(0, vitest_1.describe)('MAX_DIFF_OUTPUT_BYTES', () => {
    (0, vitest_1.it)('should be 10MB', () => {
        (0, vitest_1.expect)(diffParser_1.MAX_DIFF_OUTPUT_BYTES).toBe(10 * 1024 * 1024);
    });
});
