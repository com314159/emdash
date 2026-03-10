"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = init;
exports.refreshGithubUsername = refreshGithubUsername;
exports.capture = capture;
exports.captureException = captureException;
exports.shutdown = shutdown;
exports.isTelemetryEnabled = isTelemetryEnabled;
exports.getTelemetryStatus = getTelemetryStatus;
exports.setTelemetryEnabledViaUser = setTelemetryEnabledViaUser;
exports.checkAndReportDailyActiveUser = checkAndReportDailyActiveUser;
exports.setOnboardingSeen = setOnboardingSeen;
const electron_1 = require("electron");
// Optional build-time defaults for distribution bundles
// Resolve robustly across dev and packaged layouts.
let appConfig = {};
const fs_1 = require("fs");
const path_1 = require("path");
function loadAppConfig() {
    try {
        const dir = __dirname; // e.g., dist/main/main in dev builds
        const candidates = [
            (0, path_1.join)(dir, 'appConfig.json'), // dist/main/main/appConfig.json
            (0, path_1.join)(dir, '..', 'appConfig.json'), // dist/main/appConfig.json (CI injection path)
        ];
        for (const p of candidates) {
            if ((0, fs_1.existsSync)(p)) {
                const raw = (0, fs_1.readFileSync)(p, 'utf8');
                return JSON.parse(raw);
            }
        }
    }
    catch {
        // fall through
    }
    return {};
}
appConfig = loadAppConfig();
let enabled = true;
let apiKey;
let host;
let instanceId;
let installSource;
let userOptOut;
let onboardingSeen = false;
let sessionStartMs = Date.now();
let lastActiveDate;
let cachedGithubUsername = null;
const libName = 'emdash';
function getVersionSafe() {
    try {
        return electron_1.app.getVersion();
    }
    catch {
        return 'unknown';
    }
}
function getInstanceIdPath() {
    const dir = electron_1.app.getPath('userData');
    return (0, path_1.join)(dir, 'telemetry.json');
}
function loadOrCreateState() {
    try {
        const file = getInstanceIdPath();
        if ((0, fs_1.existsSync)(file)) {
            const raw = (0, fs_1.readFileSync)(file, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.instanceId === 'string' && parsed.instanceId.length > 0) {
                const enabledOverride = typeof parsed.enabled === 'boolean' ? parsed.enabled : undefined;
                const onboardingSeen = typeof parsed.onboardingSeen === 'boolean' ? parsed.onboardingSeen : false;
                const lastActiveDate = typeof parsed.lastActiveDate === 'string' ? parsed.lastActiveDate : undefined;
                return {
                    instanceId: parsed.instanceId,
                    enabledOverride,
                    onboardingSeen,
                    lastActiveDate,
                };
            }
        }
    }
    catch {
        // fall through to create
    }
    const newId = cryptoRandomId();
    try {
        (0, fs_1.writeFileSync)(getInstanceIdPath(), JSON.stringify({ instanceId: newId }, null, 2), 'utf8');
    }
    catch {
        // ignore
    }
    return { instanceId: newId };
}
function cryptoRandomId() {
    try {
        const { randomUUID } = require('crypto');
        return randomUUID();
    }
    catch {
        // Very old Node fallback; not expected in Electron 28+
        return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
}
function isEnabled() {
    return (enabled === true &&
        userOptOut !== true &&
        !!apiKey &&
        !!host &&
        typeof instanceId === 'string' &&
        instanceId.length > 0);
}
function getBaseProps() {
    return {
        app_version: getVersionSafe(),
        electron_version: process.versions.electron,
        platform: process.platform,
        arch: process.arch,
        is_dev: !electron_1.app.isPackaged,
        install_source: installSource ?? (electron_1.app.isPackaged ? 'dmg' : 'dev'),
        $lib: libName,
        ...(cachedGithubUsername ? { github_username: cachedGithubUsername } : {}),
    };
}
/**
 * Sanitize event properties to prevent PII leakage.
 * Simple allowlist approach: only allow safe property names and primitive types.
 */
function sanitizeEventAndProps(event, props) {
    const sanitized = {};
    // Simple allowlist of safe properties
    const allowedProps = new Set([
        'provider',
        'source',
        'tab',
        'theme',
        'trigger',
        'has_initial_prompt',
        'custom_name',
        'state',
        'success',
        'error_type',
        'gh_cli_installed',
        'github_username',
        'feature',
        'type',
        'enabled',
        'sound',
        'app',
        'duration_ms',
        'session_duration_ms',
        'outcome',
        'applied_migrations',
        'applied_migrations_bucket',
        'recovered',
        'task_count',
        'task_count_bucket',
        'project_count',
        'project_count_bucket',
        'date',
        'timezone',
        'scope',
    ]);
    if (props) {
        for (const [key, value] of Object.entries(props)) {
            // Only process allowed property names
            if (!allowedProps.has(key))
                continue;
            // Only allow primitive types
            if (typeof value === 'string') {
                // Trim and limit string length to prevent abuse
                sanitized[key] = value.trim().slice(0, 100);
            }
            else if (typeof value === 'number') {
                // Clamp numbers to reasonable range
                sanitized[key] = Math.max(0, Math.min(value, 1000000));
            }
            else if (typeof value === 'boolean') {
                sanitized[key] = value;
            }
        }
    }
    return sanitized;
}
/**
 * Fetch the current GitHub username if the user is authenticated.
 * Returns null if not authenticated or if there's an error.
 */
async function getGithubUsername() {
    try {
        // Lazy import to avoid circular dependencies
        const { githubService } = require('./services/GitHubService');
        const user = await githubService.getCurrentUser();
        return user?.login || null;
    }
    catch {
        // Silently fail if GitHub is not authenticated or there's an error
        return null;
    }
}
async function posthogCapture(event, properties) {
    if (!isEnabled())
        return;
    try {
        // Use global fetch if available (Node 18+/Electron 28+)
        const f = globalThis.fetch;
        if (!f)
            return;
        const u = (host || '').replace(/\/$/, '') + '/capture/';
        const body = {
            api_key: apiKey,
            event,
            properties: {
                distinct_id: instanceId,
                ...getBaseProps(),
                ...sanitizeEventAndProps(event, properties),
            },
        };
        await f(u, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).catch(() => undefined);
    }
    catch {
        // swallow errors; telemetry must never crash the app
    }
}
/**
 * PostHog identify call to associate the instanceId with GitHub username.
 * This creates a user profile in PostHog.
 */
async function posthogIdentify(username) {
    if (!isEnabled() || !username)
        return;
    try {
        const f = globalThis.fetch;
        if (!f)
            return;
        const u = (host || '').replace(/\/$/, '') + '/capture/';
        const body = {
            api_key: apiKey,
            event: '$identify',
            properties: {
                distinct_id: instanceId,
                $set: {
                    github_username: username,
                    ...getBaseProps(),
                },
            },
        };
        await f(u, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).catch(() => undefined);
    }
    catch {
        // swallow errors; telemetry must never crash the app
    }
}
async function init(options) {
    const env = process.env;
    const enabledEnv = (env.TELEMETRY_ENABLED ?? 'true').toString().toLowerCase();
    enabled = enabledEnv !== 'false' && enabledEnv !== '0' && enabledEnv !== 'no';
    apiKey =
        env.POSTHOG_PROJECT_API_KEY || appConfig?.posthogKey || undefined;
    host = normalizeHost(env.POSTHOG_HOST || appConfig?.posthogHost || undefined);
    installSource = options?.installSource || env.INSTALL_SOURCE || undefined;
    const state = loadOrCreateState();
    instanceId = state.instanceId;
    sessionStartMs = Date.now();
    // If enabledOverride is explicitly false, user opted out; otherwise leave undefined
    userOptOut =
        typeof state.enabledOverride === 'boolean' ? state.enabledOverride === false : undefined;
    onboardingSeen = state.onboardingSeen === true;
    lastActiveDate = state.lastActiveDate;
    // Fetch GitHub username if available and cache for all future events
    cachedGithubUsername = await getGithubUsername();
    // If we have a GitHub username, identify the user in PostHog
    if (cachedGithubUsername) {
        void posthogIdentify(cachedGithubUsername);
    }
    // Fire lifecycle start (github_username is now included via getBaseProps)
    void posthogCapture('app_started');
    // Check for daily active user (fires event if it's a new day)
    checkDailyActiveUser();
}
/**
 * Refresh the cached GitHub username. Call this when the user connects
 * their GitHub account so all subsequent events include the username.
 */
async function refreshGithubUsername() {
    cachedGithubUsername = await getGithubUsername();
    if (cachedGithubUsername) {
        void posthogIdentify(cachedGithubUsername);
    }
}
function capture(event, properties) {
    if (event === 'app_session') {
        const dur = Math.max(0, Date.now() - (sessionStartMs || Date.now()));
        void posthogCapture(event, { session_duration_ms: dur });
        return;
    }
    void posthogCapture(event, properties);
}
/**
 * Capture an exception for PostHog error tracking.
 * This sends a properly formatted $exception event as required by PostHog.
 *
 * @param error - The error object or error message
 * @param additionalProperties - Additional context properties
 */
function captureException(error, additionalProperties) {
    if (!isEnabled())
        return;
    // Build error object
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const errorMessage = errorObj.message || 'Unknown error';
    const errorStack = errorObj.stack || '';
    // Build PostHog $exception event properties
    const properties = {
        // Required fields for PostHog error tracking
        $exception_message: errorMessage,
        $exception_type: errorObj.name || 'Error',
        $exception_stack_trace_raw: errorStack,
        // Merge additional properties
        ...additionalProperties,
    };
    // Send as $exception event (required for PostHog error tracking)
    void posthogCapture('$exception', properties);
}
function shutdown() {
    // No-op for now (no batching). Left for future posthog-node integration.
}
function isTelemetryEnabled() {
    return isEnabled();
}
function getTelemetryStatus() {
    return {
        enabled: isEnabled(),
        envDisabled: !enabled,
        userOptOut: userOptOut === true,
        hasKeyAndHost: !!apiKey && !!host,
        onboardingSeen,
    };
}
function setTelemetryEnabledViaUser(enabledFlag) {
    userOptOut = !enabledFlag;
    // Persist alongside instanceId
    try {
        const file = getInstanceIdPath();
        let state = {};
        if ((0, fs_1.existsSync)(file)) {
            try {
                state = JSON.parse((0, fs_1.readFileSync)(file, 'utf8')) || {};
            }
            catch {
                state = {};
            }
        }
        state.instanceId = instanceId || state.instanceId || cryptoRandomId();
        state.enabled = enabledFlag; // store explicit preference
        state.updatedAt = new Date().toISOString();
        (0, fs_1.writeFileSync)(file, JSON.stringify(state, null, 2), 'utf8');
    }
    catch {
        // ignore
    }
}
function persistState(state) {
    try {
        const existing = (0, fs_1.existsSync)(getInstanceIdPath())
            ? JSON.parse((0, fs_1.readFileSync)(getInstanceIdPath(), 'utf8'))
            : {};
        const merged = {
            ...existing,
            instanceId: state.instanceId,
            enabled: typeof state.enabledOverride === 'boolean' ? state.enabledOverride : existing.enabled,
            onboardingSeen: typeof state.onboardingSeen === 'boolean' ? state.onboardingSeen : existing.onboardingSeen,
            lastActiveDate: typeof state.lastActiveDate === 'string' ? state.lastActiveDate : existing.lastActiveDate,
            createdAt: existing.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        (0, fs_1.writeFileSync)(getInstanceIdPath(), JSON.stringify(merged, null, 2), 'utf8');
    }
    catch {
        // ignore
    }
}
function normalizeHost(h) {
    if (!h)
        return undefined;
    let s = String(h).trim();
    if (!/^https?:\/\//i.test(s)) {
        s = 'https://' + s;
    }
    return s.replace(/\/+$/, '');
}
/**
 * Check if this is a new day of activity and fire daily_active_user event if so.
 * This ensures we accurately track DAU even when the app stays open for extended periods.
 */
async function checkDailyActiveUser() {
    // Skip if telemetry is disabled
    if (!isEnabled())
        return;
    try {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        // If we haven't tracked a date yet or it's a new day, fire the event
        if (!lastActiveDate || lastActiveDate !== today) {
            // Refresh cached GitHub username (user may have connected since init)
            cachedGithubUsername = await getGithubUsername();
            // Fire the daily active user event (github_username included via getBaseProps)
            void posthogCapture('daily_active_user', {
                date: today,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
            });
            // Update the last active date in memory
            lastActiveDate = today;
            // Persist the new date to storage
            persistState({
                instanceId: instanceId || cryptoRandomId(),
                enabledOverride: userOptOut === undefined ? undefined : !userOptOut,
                onboardingSeen,
                lastActiveDate: today,
            });
        }
    }
    catch (error) {
        // Never let telemetry errors crash the app
        // Optionally log for debugging: console.error('DAU tracking error:', error);
    }
}
/**
 * Export for use in window focus events
 */
async function checkAndReportDailyActiveUser() {
    return checkDailyActiveUser();
}
function setOnboardingSeen(flag) {
    onboardingSeen = Boolean(flag);
    try {
        persistState({
            instanceId: instanceId || cryptoRandomId(),
            onboardingSeen,
            enabledOverride: userOptOut === undefined ? undefined : !userOptOut,
        });
    }
    catch {
        // ignore
    }
}
