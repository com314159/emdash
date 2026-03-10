"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerStatusCache = exports.ProviderStatusCache = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const logger_1 = require("../lib/logger");
class ProviderStatusCache {
    constructor() {
        this.cache = {};
        this.filePath = null;
        this.persistPromise = null;
        this.pendingPersist = false;
        // lazily resolved in load/persist to avoid app readiness issues
    }
    async load() {
        if (!this.filePath) {
            this.filePath = path_1.default.join(electron_1.app.getPath('userData'), 'provider-status-cache.json');
        }
        if (!this.filePath)
            return;
        try {
            const content = await promises_1.default.readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === 'object') {
                this.cache = parsed;
            }
        }
        catch {
            this.cache = {};
        }
    }
    getAll() {
        return { ...this.cache };
    }
    get(providerId) {
        return this.cache[providerId];
    }
    set(providerId, status) {
        this.cache = {
            ...this.cache,
            [providerId]: status,
        };
        this.persist();
    }
    persist() {
        if (!this.filePath) {
            this.filePath = path_1.default.join(electron_1.app.getPath('userData'), 'provider-status-cache.json');
        }
        if (!this.filePath)
            return;
        if (this.persistPromise) {
            this.pendingPersist = true;
            return;
        }
        const write = () => {
            const payload = JSON.stringify(this.cache, null, 2);
            this.persistPromise = promises_1.default
                .writeFile(this.filePath, payload, 'utf8')
                .catch((error) => {
                logger_1.log.warn('providerStatusCache:persist failed', {
                    filePath: this.filePath,
                    error: error?.message || String(error),
                });
            })
                .finally(() => {
                this.persistPromise = null;
                const shouldRetry = this.pendingPersist;
                this.pendingPersist = false;
                if (shouldRetry) {
                    setTimeout(() => this.persist(), 250);
                }
            });
        };
        write();
    }
}
exports.ProviderStatusCache = ProviderStatusCache;
exports.providerStatusCache = new ProviderStatusCache();
