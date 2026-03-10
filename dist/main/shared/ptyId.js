"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makePtyId = makePtyId;
exports.parsePtyId = parsePtyId;
exports.isMainPty = isMainPty;
exports.isChatPty = isChatPty;
const registry_1 = require("./providers/registry");
// Delimiter chosen to be unambiguous — providers are validated against PROVIDER_IDS
const MAIN_SEP = '-main-';
const CHAT_SEP = '-chat-';
function makePtyId(provider, kind, suffix) {
    const sep = kind === 'main' ? MAIN_SEP : CHAT_SEP;
    return `${provider}${sep}${suffix}`;
}
function parsePtyId(id) {
    // Try each known provider prefix to avoid ambiguity from greedy matching.
    // Longest-first so e.g. "continue" is tried before a hypothetical "co".
    const sorted = [...registry_1.PROVIDER_IDS].sort((a, b) => b.length - a.length);
    for (const pid of sorted) {
        if (id.startsWith(pid + MAIN_SEP)) {
            return { providerId: pid, kind: 'main', suffix: id.slice(pid.length + MAIN_SEP.length) };
        }
        if (id.startsWith(pid + CHAT_SEP)) {
            return { providerId: pid, kind: 'chat', suffix: id.slice(pid.length + CHAT_SEP.length) };
        }
    }
    return null;
}
/** Quick check without full parse */
function isMainPty(id) {
    return id.includes(MAIN_SEP);
}
function isChatPty(id) {
    return id.includes(CHAT_SEP) && !id.includes(MAIN_SEP);
}
