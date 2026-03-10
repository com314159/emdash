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
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorTracking = void 0;
exports.captureException = captureException;
const electron_1 = require("electron");
const telemetry = __importStar(require("./telemetry"));
const logger_1 = require("./lib/logger");
class ErrorTracking {
    constructor() {
        this.githubUsername = null;
        this.sessionErrors = 0;
        this.lastErrorTimestamp = 0;
    }
    /**
     * Initialize error tracking
     */
    async init() {
        try {
            this.githubUsername = await this.fetchGithubUsername();
            if (this.githubUsername) {
                logger_1.log.info('ErrorTracking initialized with GitHub user', { username: this.githubUsername });
            }
        }
        catch {
            // Silent fail
        }
    }
    async captureException(error, context) {
        try {
            // Rate limiting to prevent error spam
            const now = Date.now();
            if (now - this.lastErrorTimestamp < 100) {
                return; // Skip if error happened within 100ms
            }
            this.lastErrorTimestamp = now;
            this.sessionErrors++;
            // Build error object
            const errorObj = error instanceof Error ? error : new Error(String(error));
            const errorMessage = errorObj.message || 'Unknown error';
            const errorStack = errorObj.stack || '';
            if (!this.githubUsername) {
                this.githubUsername = await this.fetchGithubUsername();
            }
            // Determine severity if not provided
            const severity = context?.severity || this.determineSeverity(errorMessage, context);
            // Build comprehensive error properties following PostHog's $exception format
            const properties = {
                // PostHog required fields for error tracking
                $exception_message: errorMessage.slice(0, 500), // Required by PostHog
                $exception_type: context?.error_type || this.classifyError(errorMessage), // Required
                $exception_stack_trace_raw: errorStack.slice(0, 2000), // Required for stack traces
                $exception_fingerprint: `${context?.service || 'unknown'}_${context?.operation || 'unknown'}_${context?.error_type || this.classifyError(errorMessage)}`, // For grouping
                // Additional context
                severity,
                // User context
                github_username: this.githubUsername,
                // Session context
                session_errors: this.sessionErrors,
                app_version: this.getAppVersion(),
                electron_version: process.versions.electron,
                platform: process.platform,
                arch: process.arch,
                is_dev: !electron_1.app.isPackaged,
                // Operation context
                operation: context?.operation,
                service: context?.service,
                component: context?.component || 'main',
                // Agent/Provider context
                provider: context?.provider,
                task_id: context?.task_id,
                workspace_id: context?.workspace_id,
                // Project context
                project_id: context?.project_id,
                project_path: context?.project_path,
                // Git context
                branch_name: context?.branch_name,
                worktree_path: context?.worktree_path,
                git_operation: context?.git_operation,
                // Timestamp
                error_timestamp: new Date().toISOString(),
                // Additional custom context
                ...this.sanitizeContext(context),
            };
            // Filter out undefined/null values
            const cleanProperties = Object.fromEntries(Object.entries(properties).filter(([_, v]) => v !== undefined && v !== null));
            // Send to PostHog using proper exception tracking
            telemetry.captureException(errorObj, cleanProperties);
            // Also log locally for debugging
            logger_1.log.error('Exception captured', {
                message: errorMessage,
                severity,
                operation: context?.operation,
                service: context?.service,
            });
        }
        catch (trackingError) {
            // Never let error tracking crash the app
            logger_1.log.warn('Failed to capture exception', { error: trackingError });
        }
    }
    /**
     * Capture a critical error that might affect app stability
     */
    async captureCriticalError(error, context) {
        await this.captureException(error, {
            ...context,
            severity: 'critical',
        });
    }
    /**
     * Track agent provider spawn errors
     */
    async captureAgentSpawnError(error, provider, taskId, additionalContext) {
        await this.captureException(error, {
            operation: 'agent_spawn',
            service: 'ptyManager',
            error_type: 'spawn_error',
            severity: 'high',
            provider,
            task_id: taskId,
            ...additionalContext,
        });
    }
    /**
     * Track project initialization errors
     */
    async captureProjectError(error, operation, projectPath, additionalContext) {
        await this.captureException(error, {
            operation: `project_${operation}`,
            service: 'projectIpc',
            error_type: 'project_error',
            severity: operation === 'create' || operation === 'clone' ? 'high' : 'medium',
            project_path: projectPath,
            ...additionalContext,
        });
    }
    /**
     * Track worktree creation errors
     */
    async captureWorktreeError(error, operation, worktreePath, branchName, additionalContext) {
        await this.captureException(error, {
            operation: `worktree_${operation}`,
            service: 'WorktreeService',
            error_type: 'worktree_error',
            severity: 'high',
            worktree_path: worktreePath,
            branch_name: branchName,
            ...additionalContext,
        });
    }
    /**
     * Track GitHub API errors
     */
    async captureGitHubError(error, operation, additionalContext) {
        await this.captureException(error, {
            operation: `github_${operation}`,
            service: 'GitHubService',
            error_type: 'github_error',
            severity: this.isAuthError(error) ? 'critical' : 'medium',
            ...additionalContext,
        });
    }
    /**
     * Track database errors
     */
    async captureDatabaseError(error, operation, additionalContext) {
        await this.captureException(error, {
            operation: `db_${operation}`,
            service: 'DatabaseService',
            error_type: 'database_error',
            severity: 'high',
            ...additionalContext,
        });
    }
    /**
     * Update GitHub username (call when user authenticates)
     */
    async updateGithubUsername(username) {
        this.githubUsername = username;
    }
    // Private helper methods
    async fetchGithubUsername() {
        try {
            // Lazy import to avoid circular dependencies
            const { githubService } = require('./services/GitHubService');
            const user = await githubService.getCurrentUser();
            return user?.login || null;
        }
        catch {
            return null;
        }
    }
    getAppVersion() {
        try {
            return electron_1.app.getVersion();
        }
        catch {
            return 'unknown';
        }
    }
    determineSeverity(errorMessage, context) {
        // Critical errors
        if (errorMessage.includes('FATAL') ||
            errorMessage.includes('CRASH') ||
            errorMessage.includes('out of memory') ||
            context?.error_type === 'database_error') {
            return 'critical';
        }
        // High severity
        if (errorMessage.includes('spawn') ||
            errorMessage.includes('PTY') ||
            errorMessage.includes('worktree') ||
            errorMessage.includes('permission denied') ||
            context?.operation?.includes('agent_spawn')) {
            return 'high';
        }
        // Low severity
        if (errorMessage.includes('canceled') ||
            errorMessage.includes('aborted') ||
            errorMessage.includes('timeout')) {
            return 'low';
        }
        return 'medium';
    }
    classifyError(errorMessage) {
        if (errorMessage.includes('spawn') || errorMessage.includes('PTY')) {
            return 'spawn_error';
        }
        if (errorMessage.includes('git') || errorMessage.includes('worktree')) {
            return 'git_error';
        }
        if (errorMessage.includes('database') || errorMessage.includes('sqlite')) {
            return 'database_error';
        }
        if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
            return 'network_error';
        }
        if (errorMessage.includes('permission') || errorMessage.includes('EACCES')) {
            return 'permission_error';
        }
        if (errorMessage.includes('not found') || errorMessage.includes('ENOENT')) {
            return 'file_not_found';
        }
        return 'unknown_error';
    }
    isAuthError(error) {
        const message = error instanceof Error ? error.message : String(error);
        return (message.includes('auth') ||
            message.includes('unauthorized') ||
            message.includes('401') ||
            message.includes('403'));
    }
    sanitizeContext(context) {
        if (!context)
            return {};
        // Remove sensitive keys and limit string lengths
        const sanitized = {};
        const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];
        for (const [key, value] of Object.entries(context)) {
            // Skip if already processed or sensitive
            if (['severity', 'operation', 'service', 'component', 'error_type'].includes(key)) {
                continue;
            }
            if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
                continue;
            }
            // Sanitize value
            if (typeof value === 'string') {
                sanitized[key] = value.slice(0, 200);
            }
            else if (typeof value === 'number' || typeof value === 'boolean') {
                sanitized[key] = value;
            }
            else if (value === null || value === undefined) {
                // Skip null/undefined
            }
            else {
                // Convert objects to string with limit
                try {
                    sanitized[key] = JSON.stringify(value).slice(0, 200);
                }
                catch {
                    // Skip if can't stringify
                }
            }
        }
        return sanitized;
    }
}
// Export singleton instance
exports.errorTracking = new ErrorTracking();
// Export helper for backward compatibility
function captureException(error, context) {
    return exports.errorTracking.captureException(error, context);
}
