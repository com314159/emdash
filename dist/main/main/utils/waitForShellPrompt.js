"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForShellPrompt = waitForShellPrompt;
const stripAnsi_1 = require("@shared/text/stripAnsi");
/**
 * Matches common shell prompt endings: $, #, %, >, ❯ preceded by a non-digit, non-space character.
 * Each chunk is matched independently — prompts split across TCP segments rely on the timeout fallback.
 */
const SHELL_PROMPT_RE = /\S.*(?<!\d)[#$%>❯]\s*$/;
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
        const clean = (0, stripAnsi_1.stripAnsi)(chunk, { includePrivateCsiParams: true });
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
