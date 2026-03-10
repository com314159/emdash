"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForShellPrompt = waitForShellPrompt;
/**
 * Matches common shell prompt endings: $, #, %, >, ❯ preceded by a non-digit, non-space character.
 * Each chunk is matched independently — prompts split across TCP segments rely on the timeout fallback.
 */
const SHELL_PROMPT_RE = /\S.*(?<!\d)[#$%>❯]\s*$/;
function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '');
}
/**
 * Waits for a shell prompt to appear in PTY output before writing data.
 * Falls back to writing after a configurable timeout.
 */
function waitForShellPrompt(options) {
    const { subscribe, write, data, timeoutMs = 15000, onTimeout } = options;
    const noop = { cancel: () => { } };
    if (!data)
        return noop;
    let done = false;
    const finish = () => {
        if (done)
            return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        write(data);
    };
    const cancel = () => {
        if (done)
            return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
    };
    const unsubscribe = subscribe((chunk) => {
        if (done)
            return;
        const clean = stripAnsi(chunk);
        if (SHELL_PROMPT_RE.test(clean)) {
            finish();
        }
    });
    const timer = setTimeout(() => {
        onTimeout?.();
        finish();
    }, timeoutMs);
    return { cancel };
}
