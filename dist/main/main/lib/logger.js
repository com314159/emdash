"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = void 0;
function envLevel() {
    const hasDebugFlag = process.argv.includes('--debug-logs') || process.argv.includes('--dev');
    if (hasDebugFlag)
        return 'debug';
    return 'warn';
}
function enabled(target, current) {
    const order = { debug: 10, info: 20, warn: 30, error: 40 };
    return order[target] >= order[current];
}
const current = envLevel();
exports.log = {
    debug: (...args) => {
        if (enabled('debug', current)) {
            // eslint-disable-next-line no-console
            console.debug(...args);
        }
    },
    info: (...args) => {
        if (enabled('info', current)) {
            // eslint-disable-next-line no-console
            console.info(...args);
        }
    },
    warn: (...args) => {
        if (enabled('warn', current)) {
            // eslint-disable-next-line no-console
            console.warn(...args);
        }
    },
    error: (...args) => {
        // eslint-disable-next-line no-console
        console.error(...args);
    },
};
