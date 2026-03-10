"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adaptForward = adaptForward;
exports.adaptReverse = adaptReverse;
// ── Helpers ────────────────────────────────────────────────────────────────
function isHttpServer(s) {
    return s.type === 'http';
}
function isStdio(s) {
    return !isHttpServer(s) && s.command !== undefined;
}
const INJECTED_ACCEPT = 'application/json, text/event-stream';
function ensureHeader(headers, key, val) {
    if (typeof headers[key] !== 'string') {
        headers[key] = val;
    }
}
function stripInjectedHeaders(entry) {
    if (typeof entry.headers !== 'object' || entry.headers === null)
        return;
    const headers = entry.headers;
    if (headers.Accept === INJECTED_ACCEPT) {
        delete headers.Accept;
        if (!Object.keys(headers).length) {
            delete entry.headers;
        }
    }
}
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
function transformHttpServers(servers, fn) {
    const result = {};
    for (const [k, v] of Object.entries(servers)) {
        if (typeof v === 'object' && v !== null && isHttpServer(v)) {
            result[k] = fn(deepClone(v));
        }
        else {
            result[k] = deepClone(v);
        }
    }
    return result;
}
// ── Forward Adapters (canonical → agent) ───────────────────────────────────
function fwdPassthrough(servers) {
    return deepClone(servers);
}
function fwdGemini(servers) {
    return transformHttpServers(servers, (s) => {
        const url = s.url ?? '';
        const headers = {
            ...(s.headers ?? {}),
        };
        ensureHeader(headers, 'Accept', 'application/json, text/event-stream');
        const result = { httpUrl: url, headers };
        if (s.env && typeof s.env === 'object')
            result.env = s.env;
        return result;
    });
}
function fwdCursor(servers) {
    return transformHttpServers(servers, (s) => {
        const url = s.url ?? '';
        const headers = s.headers ?? {};
        const result = { url, headers };
        if (s.env && typeof s.env === 'object')
            result.env = s.env;
        return result;
    });
}
function fwdCodex(servers) {
    const result = {};
    for (const [k, v] of Object.entries(servers)) {
        if (typeof v === 'object' && v !== null && isStdio(v)) {
            result[k] = deepClone(v);
        }
    }
    return result;
}
function fwdOpencode(servers) {
    const result = {};
    for (const [k, v] of Object.entries(servers)) {
        if (typeof v !== 'object' || v === null) {
            result[k] = v;
            continue;
        }
        if (isHttpServer(v)) {
            const headers = {
                ...(v.headers ?? {}),
            };
            ensureHeader(headers, 'Accept', 'application/json, text/event-stream');
            const entry = { type: 'remote', url: v.url ?? '', headers, enabled: true };
            if (v.env && typeof v.env === 'object')
                entry.env = v.env;
            result[k] = entry;
        }
        else if (isStdio(v)) {
            const cmdVec = [];
            if (typeof v.command === 'string' && v.command)
                cmdVec.push(v.command);
            if (Array.isArray(v.args))
                cmdVec.push(...v.args);
            const entry = { type: 'local', command: cmdVec, enabled: true };
            if (v.env && typeof v.env === 'object')
                entry.env = v.env;
            result[k] = entry;
        }
        else {
            result[k] = deepClone(v);
        }
    }
    return result;
}
function fwdCopilot(servers) {
    const result = {};
    for (const [k, v] of Object.entries(servers)) {
        if (typeof v === 'object' && v !== null && !('tools' in v)) {
            result[k] = { ...deepClone(v), tools: ['*'] };
        }
        else {
            result[k] = deepClone(v);
        }
    }
    return result;
}
// ── Reverse Adapters (agent → canonical) ───────────────────────────────────
function revPassthrough(servers) {
    return deepClone(servers);
}
function revGemini(servers) {
    const result = {};
    for (const [k, v] of Object.entries(servers)) {
        if (typeof v === 'object' && v !== null && 'httpUrl' in v) {
            const { httpUrl, ...rest } = v;
            const entry = { ...rest, type: 'http', url: httpUrl };
            stripInjectedHeaders(entry);
            result[k] = entry;
        }
        else {
            result[k] = deepClone(v);
        }
    }
    return result;
}
function revCursor(servers) {
    const result = {};
    for (const [k, v] of Object.entries(servers)) {
        if (typeof v === 'object' && v !== null && 'url' in v && !('command' in v)) {
            result[k] = { ...deepClone(v), type: 'http' };
        }
        else {
            result[k] = deepClone(v);
        }
    }
    return result;
}
function revCodex(servers) {
    return deepClone(servers);
}
function revOpencode(servers) {
    const result = {};
    for (const [k, v] of Object.entries(servers)) {
        if (typeof v !== 'object' || v === null) {
            result[k] = v;
            continue;
        }
        if (v.type === 'remote') {
            const { type: _, enabled: _e, ...rest } = v;
            const entry = { ...rest, type: 'http' };
            stripInjectedHeaders(entry);
            result[k] = entry;
        }
        else if (v.type === 'local' && Array.isArray(v.command)) {
            const cmdArr = v.command;
            const [command, ...args] = cmdArr;
            const entry = {};
            if (command)
                entry.command = command;
            if (args.length)
                entry.args = args;
            result[k] = entry;
        }
        else {
            result[k] = deepClone(v);
        }
    }
    return result;
}
function revCopilot(servers) {
    const result = {};
    for (const [k, v] of Object.entries(servers)) {
        if (typeof v === 'object' && v !== null) {
            const clone = deepClone(v);
            if (Array.isArray(clone.tools) && clone.tools.length === 1 && clone.tools[0] === '*') {
                delete clone.tools;
            }
            result[k] = clone;
        }
        else {
            result[k] = v;
        }
    }
    return result;
}
// ── Public API ─────────────────────────────────────────────────────────────
const FORWARD = {
    passthrough: fwdPassthrough,
    gemini: fwdGemini,
    cursor: fwdCursor,
    codex: fwdCodex,
    opencode: fwdOpencode,
    copilot: fwdCopilot,
};
const REVERSE = {
    passthrough: revPassthrough,
    gemini: revGemini,
    cursor: revCursor,
    codex: revCodex,
    opencode: revOpencode,
    copilot: revCopilot,
};
function adaptForward(adapter, servers) {
    return FORWARD[adapter](servers);
}
function adaptReverse(adapter, servers) {
    return REVERSE[adapter](servers);
}
