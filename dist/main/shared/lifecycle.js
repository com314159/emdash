"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_LIFECYCLE_LOG_LINES = exports.LIFECYCLE_PHASE_STATES = exports.LIFECYCLE_EVENT_STATUSES = exports.LIFECYCLE_PHASES = exports.LIFECYCLE_EVENT_CHANNEL = void 0;
exports.formatLifecycleLogLine = formatLifecycleLogLine;
exports.LIFECYCLE_EVENT_CHANNEL = 'lifecycle:event';
exports.LIFECYCLE_PHASES = ['setup', 'run', 'teardown'];
exports.LIFECYCLE_EVENT_STATUSES = ['starting', 'line', 'done', 'error', 'exit'];
exports.LIFECYCLE_PHASE_STATES = ['idle', 'running', 'succeeded', 'failed'];
exports.MAX_LIFECYCLE_LOG_LINES = 300;
function formatLifecycleLogLine(phase, status, extras) {
    if (status === 'starting')
        return `$ ${phase} started\n`;
    if (status === 'line' && typeof extras?.line === 'string')
        return extras.line;
    if (status === 'done')
        return `$ ${phase} finished (exit ${extras?.exitCode ?? 0})\n`;
    if (status === 'error') {
        const detail = typeof extras?.error === 'string' ? `: ${extras.error}` : '';
        return `$ ${phase} failed (exit ${extras?.exitCode ?? 'unknown'})${detail}\n`;
    }
    if (phase === 'run' && status === 'exit') {
        const code = extras?.exitCode === null ? 'signal' : extras?.exitCode;
        return `$ run exited (${code})\n`;
    }
    return null;
}
