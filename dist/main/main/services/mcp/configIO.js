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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readServers = readServers;
exports.writeServers = writeServers;
const fs = __importStar(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const jsoncParser = __importStar(require("jsonc-parser"));
const toml = __importStar(require("smol-toml"));
const logger_1 = require("../../lib/logger");
// ── Read ───────────────────────────────────────────────────────────────────
async function readServers(meta) {
    let content;
    try {
        content = await fs.readFile(meta.configPath, 'utf-8');
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return {};
        throw err;
    }
    if (!content.trim())
        return {};
    let parsed;
    if (meta.isToml) {
        parsed = toml.parse(content);
    }
    else if (meta.configPath.endsWith('.jsonc')) {
        const errors = [];
        parsed = (jsoncParser.parse(content, errors) ?? {});
        if (errors.length) {
            logger_1.log.warn(`JSONC parse errors in ${meta.configPath}:`, errors);
        }
    }
    else {
        try {
            parsed = JSON.parse(content);
        }
        catch {
            logger_1.log.warn(`Invalid JSON in ${meta.configPath}, returning empty`);
            return {};
        }
    }
    return extractAtPath(parsed, meta.serversPath);
}
function extractAtPath(obj, pathSegments) {
    let current = obj;
    for (const key of pathSegments) {
        if (typeof current !== 'object' || current === null)
            return {};
        current = current[key];
        if (current === undefined)
            return {};
    }
    if (typeof current !== 'object' || current === null || Array.isArray(current))
        return {};
    // Filter out non-object entries and the "meta" key
    const result = {};
    for (const [k, v] of Object.entries(current)) {
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            result[k] = v;
        }
    }
    return result;
}
// ── Write ──────────────────────────────────────────────────────────────────
async function writeServers(meta, servers) {
    // Ensure parent directory exists
    await fs.mkdir(path_1.default.dirname(meta.configPath), { recursive: true });
    // Read existing config or use template
    let existing;
    let existingRaw;
    try {
        existingRaw = await fs.readFile(meta.configPath, 'utf-8');
    }
    catch (err) {
        if (err.code !== 'ENOENT')
            throw err;
    }
    if (meta.isToml) {
        existing = existingRaw
            ? toml.parse(existingRaw)
            : { ...meta.template };
        setAtPath(existing, meta.serversPath, servers);
        await fs.writeFile(meta.configPath, toml.stringify(existing));
        return;
    }
    if (meta.configPath.endsWith('.jsonc') && existingRaw) {
        // Use jsonc-parser modify() to preserve comments
        let modified = existingRaw;
        // First, set the entire servers object at the path
        const edits = jsoncParser.modify(modified, meta.serversPath, servers, {});
        modified = jsoncParser.applyEdits(modified, edits);
        await fs.writeFile(meta.configPath, modified);
        return;
    }
    // Plain JSON
    if (existingRaw) {
        try {
            existing = JSON.parse(existingRaw);
        }
        catch {
            logger_1.log.warn(`Invalid JSON in ${meta.configPath}, resetting to template`);
            existing = JSON.parse(JSON.stringify(meta.template));
        }
    }
    else {
        existing = JSON.parse(JSON.stringify(meta.template));
    }
    setAtPath(existing, meta.serversPath, servers);
    await fs.writeFile(meta.configPath, JSON.stringify(existing, null, 2));
}
function setAtPath(obj, pathSegments, value) {
    let current = obj;
    for (let i = 0; i < pathSegments.length - 1; i++) {
        const key = pathSegments[i];
        if (typeof current[key] !== 'object' || current[key] === null) {
            current[key] = {};
        }
        current = current[key];
    }
    if (pathSegments.length > 0) {
        current[pathSegments[pathSegments.length - 1]] = value;
    }
}
