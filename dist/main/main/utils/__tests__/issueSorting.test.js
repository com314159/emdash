"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const issueSorting_1 = require("../issueSorting");
(0, vitest_1.describe)('updatedAtToTimestamp', () => {
    (0, vitest_1.it)('returns 0 for missing or invalid timestamps', () => {
        (0, vitest_1.expect)((0, issueSorting_1.updatedAtToTimestamp)()).toBe(0);
        (0, vitest_1.expect)((0, issueSorting_1.updatedAtToTimestamp)(null)).toBe(0);
        (0, vitest_1.expect)((0, issueSorting_1.updatedAtToTimestamp)('not-a-date')).toBe(0);
    });
    (0, vitest_1.it)('parses valid ISO timestamps', () => {
        (0, vitest_1.expect)((0, issueSorting_1.updatedAtToTimestamp)('2026-03-04T10:30:00.000Z')).toBe(1772620200000);
    });
});
(0, vitest_1.describe)('sortByUpdatedAtDesc', () => {
    (0, vitest_1.it)('sorts most recent updatedAt first', () => {
        const issues = [
            { id: 'old', updatedAt: '2026-03-01T00:00:00.000Z' },
            { id: 'newest', updatedAt: '2026-03-04T00:00:00.000Z' },
            { id: 'mid', updatedAt: '2026-03-02T00:00:00.000Z' },
        ];
        const sorted = (0, issueSorting_1.sortByUpdatedAtDesc)(issues);
        (0, vitest_1.expect)(sorted.map((issue) => issue.id)).toEqual(['newest', 'mid', 'old']);
    });
    (0, vitest_1.it)('pushes missing or invalid updatedAt to the end', () => {
        const issues = [
            { id: 'missing', updatedAt: null },
            { id: 'valid', updatedAt: '2026-03-04T00:00:00.000Z' },
            { id: 'invalid', updatedAt: 'bogus' },
        ];
        const sorted = (0, issueSorting_1.sortByUpdatedAtDesc)(issues);
        (0, vitest_1.expect)(sorted[0]?.id).toBe('valid');
        (0, vitest_1.expect)(new Set(sorted.slice(1).map((issue) => issue.id))).toEqual(new Set(['missing', 'invalid']));
    });
});
