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
exports.agentEventService = void 0;
const http_1 = __importDefault(require("http"));
const crypto_1 = __importDefault(require("crypto"));
const electron_1 = require("electron");
const logger_1 = require("../lib/logger");
const ptyId_1 = require("@shared/ptyId");
const window_1 = require("../app/window");
const registry_1 = require("@shared/providers/registry");
const settings_1 = require("../settings");
function mapProviderNotificationType(type, providerId, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
raw) {
    const explicitNotificationType = raw.notification_type || raw.notificationType;
    if (explicitNotificationType) {
        return explicitNotificationType;
    }
    // Codex emits turn-complete notifications when it is ready for the next user input.
    if (type === 'notification' && providerId === 'codex' && raw.type === 'agent-turn-complete') {
        return 'idle_prompt';
    }
    return undefined;
}
/** Suppress duplicate OS notifications for the same PTY within this window. */
const NOTIFICATION_DEDUP_MS = 60000;
class AgentEventService {
    constructor() {
        this.server = null;
        this.port = 0;
        this.token = '';
        /** Tracks the last OS notification timestamp per ptyId to suppress duplicates. */
        this.recentNotifications = new Map();
    }
    async start() {
        if (this.server)
            return;
        this.token = crypto_1.default.randomUUID();
        this.server = http_1.default.createServer((req, res) => {
            if (req.method !== 'POST' || req.url !== '/hook') {
                res.writeHead(404);
                res.end();
                return;
            }
            const authToken = req.headers['x-emdash-token'];
            if (authToken !== this.token) {
                logger_1.log.warn('AgentEventService: rejected request with invalid token');
                res.writeHead(403);
                res.end();
                return;
            }
            let body = '';
            req.on('data', (chunk) => {
                body += chunk.toString();
                // Guard against oversized payloads
                if (body.length > 1000000) {
                    req.destroy();
                }
            });
            req.on('end', async () => {
                try {
                    // ptyId and event type come from headers (not body) so the
                    // payload can be piped from stdin via `curl -d @-` without
                    // any shell interpolation of its contents.
                    const ptyId = String(req.headers['x-emdash-pty-id'] || '');
                    const type = String(req.headers['x-emdash-event-type'] || '');
                    if (!ptyId || !type) {
                        logger_1.log.warn('AgentEventService: malformed request — missing ptyId or type headers');
                        res.writeHead(400);
                        res.end();
                        return;
                    }
                    const parsed = (0, ptyId_1.parsePtyId)(ptyId);
                    if (!parsed) {
                        logger_1.log.warn('AgentEventService: unrecognised ptyId', { ptyId });
                        res.writeHead(400);
                        res.end();
                        return;
                    }
                    // Body is the raw provider hook payload JSON
                    const raw = body ? JSON.parse(body) : {};
                    // Normalize snake_case fields from provider hooks to camelCase
                    const normalizedPayload = {
                        ...raw,
                        notificationType: mapProviderNotificationType(type, parsed.providerId, raw),
                        lastAssistantMessage: raw.last_assistant_message ??
                            raw.lastAssistantMessage ??
                            raw['last-assistant-message'],
                    };
                    delete normalizedPayload.notification_type;
                    delete normalizedPayload.last_assistant_message;
                    delete normalizedPayload['last-assistant-message'];
                    const event = {
                        type: type,
                        ptyId,
                        taskId: parsed.suffix,
                        providerId: parsed.providerId,
                        timestamp: Date.now(),
                        payload: normalizedPayload,
                    };
                    const windows = electron_1.BrowserWindow.getAllWindows();
                    const appFocused = windows.some((w) => !w.isDestroyed() && w.isFocused());
                    await this.maybeShowOsNotification(event, appFocused);
                    for (const win of windows) {
                        try {
                            if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                                win.webContents.send('agent:event', event, { appFocused });
                            }
                        }
                        catch {
                            // Window may have been destroyed between check and send
                        }
                    }
                    res.writeHead(200);
                    res.end();
                }
                catch (err) {
                    logger_1.log.warn('AgentEventService: failed to parse request body', { error: String(err) });
                    res.writeHead(400);
                    res.end();
                }
            });
        });
        return new Promise((resolve, reject) => {
            this.server.listen(0, '127.0.0.1', () => {
                const addr = this.server.address();
                if (addr && typeof addr === 'object') {
                    this.port = addr.port;
                }
                logger_1.log.info('AgentEventService: started', { port: this.port });
                resolve();
            });
            this.server.on('error', (err) => {
                logger_1.log.error('AgentEventService: failed to start', { error: String(err) });
                reject(err);
            });
        });
    }
    async maybeShowOsNotification(event, appFocused) {
        try {
            const settings = (0, settings_1.getAppSettings)();
            if (!settings.notifications?.enabled)
                return;
            if (!settings.notifications?.osNotifications)
                return;
            if (appFocused)
                return;
            if (!electron_1.Notification.isSupported())
                return;
            // Deduplicate: suppress if we recently showed a notification for this PTY.
            // Claude Code fires both Notification (idle_prompt) and Stop hooks on
            // completion, which arrive seconds apart with the same message.
            const now = Date.now();
            const lastShown = this.recentNotifications.get(event.ptyId);
            if (lastShown && now - lastShown < NOTIFICATION_DEDUP_MS)
                return;
            const providerName = (0, registry_1.getProvider)(event.providerId)?.name ?? event.providerId;
            const isMain = (0, ptyId_1.isMainPty)(event.ptyId);
            let taskName = null;
            if (isMain) {
                const { databaseService } = await Promise.resolve().then(() => __importStar(require('./DatabaseService')));
                const task = await databaseService.getTaskById(event.taskId);
                if (task?.name)
                    taskName = task.name;
            }
            const titleSuffix = taskName ? ` — ${taskName}` : '';
            const addClickHandler = (notification) => {
                notification.on('click', () => {
                    const win = (0, window_1.getMainWindow)();
                    if (win && !win.isDestroyed()) {
                        if (win.isMinimized())
                            win.restore();
                        win.show();
                        win.focus();
                        if (isMain) {
                            win.webContents.send('notification:focus-task', event.taskId);
                        }
                    }
                });
            };
            let shown = false;
            if (event.type === 'stop') {
                const notification = new electron_1.Notification({
                    title: `${providerName}${titleSuffix}`,
                    body: event.payload.message?.trim() || 'Your agent has finished working',
                    silent: true,
                });
                addClickHandler(notification);
                notification.show();
                shown = true;
            }
            else if (event.type === 'notification') {
                const nt = event.payload.notificationType;
                if (nt === 'permission_prompt' || nt === 'idle_prompt' || nt === 'elicitation_dialog') {
                    const notification = new electron_1.Notification({
                        title: `${providerName}${titleSuffix}`,
                        body: event.payload.message?.trim() || 'Your agent is waiting for input',
                        silent: true,
                    });
                    addClickHandler(notification);
                    notification.show();
                    shown = true;
                }
            }
            if (shown) {
                this.recentNotifications.set(event.ptyId, now);
                // Prevent unbounded growth: prune stale entries
                if (this.recentNotifications.size > 200) {
                    for (const [key, ts] of this.recentNotifications) {
                        if (now - ts > NOTIFICATION_DEDUP_MS)
                            this.recentNotifications.delete(key);
                    }
                }
            }
        }
        catch (error) {
            logger_1.log.warn('AgentEventService: failed to show OS notification', { error: String(error) });
        }
    }
    stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
            this.port = 0;
        }
    }
    getPort() {
        return this.port;
    }
    getToken() {
        return this.token;
    }
}
exports.agentEventService = new AgentEventService();
