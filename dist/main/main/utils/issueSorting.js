"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatedAtToTimestamp = updatedAtToTimestamp;
exports.sortByUpdatedAtDesc = sortByUpdatedAtDesc;
function updatedAtToTimestamp(updatedAt) {
    if (!updatedAt) {
        return 0;
    }
    const parsed = Date.parse(updatedAt);
    return Number.isFinite(parsed) ? parsed : 0;
}
function sortByUpdatedAtDesc(items) {
    return [...items].sort((a, b) => {
        return updatedAtToTimestamp(b.updatedAt) - updatedAtToTimestamp(a.updatedAt);
    });
}
