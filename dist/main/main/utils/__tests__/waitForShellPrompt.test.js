"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const waitForShellPrompt_1 = require("../waitForShellPrompt");
(0, vitest_1.describe)('waitForShellPrompt', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.useFakeTimers();
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.useRealTimers();
    });
    function createMockPty() {
        const listeners = [];
        return {
            subscribe: (cb) => {
                listeners.push(cb);
                return () => {
                    const idx = listeners.indexOf(cb);
                    if (idx >= 0)
                        listeners.splice(idx, 1);
                };
            },
            write: vitest_1.vi.fn(),
            emit: (data) => {
                for (const cb of [...listeners])
                    cb(data);
            },
            listenerCount: () => listeners.length,
        };
    }
    (0, vitest_1.it)('writes data after detecting a $ prompt', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        (0, vitest_1.expect)(pty.write).not.toHaveBeenCalled();
        pty.emit('user@host:~$ ');
        (0, vitest_1.expect)(pty.write).toHaveBeenCalledWith('cd /foo\n');
    });
    (0, vitest_1.it)('writes data after detecting a # prompt (root)', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        pty.emit('root@host:~# ');
        (0, vitest_1.expect)(pty.write).toHaveBeenCalledWith('cd /foo\n');
    });
    (0, vitest_1.it)('writes data after detecting a % prompt (zsh)', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        pty.emit('host% ');
        (0, vitest_1.expect)(pty.write).toHaveBeenCalledWith('cd /foo\n');
    });
    (0, vitest_1.it)('writes data after detecting a > prompt', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        pty.emit('PS> ');
        (0, vitest_1.expect)(pty.write).toHaveBeenCalledWith('cd /foo\n');
    });
    (0, vitest_1.it)('writes data after detecting a ❯ prompt (starship)', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        pty.emit('~/projects ❯ ');
        (0, vitest_1.expect)(pty.write).toHaveBeenCalledWith('cd /foo\n');
    });
    (0, vitest_1.it)('strips ANSI codes before matching', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        pty.emit('\x1b[32muser@host\x1b[0m:\x1b[34m~\x1b[0m$ ');
        (0, vitest_1.expect)(pty.write).toHaveBeenCalledWith('cd /foo\n');
    });
    (0, vitest_1.it)('strips OSC sequences before matching', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        pty.emit('\x1b]0;user@host:~\x07user@host:~$ ');
        (0, vitest_1.expect)(pty.write).toHaveBeenCalledWith('cd /foo\n');
    });
    (0, vitest_1.it)('does not match a bare prompt character with no preceding context', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        pty.emit('$ ');
        (0, vitest_1.expect)(pty.write).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('does not match MOTD content that lacks prompt characters at end', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        pty.emit('Welcome to Ubuntu 22.04 LTS\r\n');
        (0, vitest_1.expect)(pty.write).not.toHaveBeenCalled();
        pty.emit('Last login: Mon Jan 1 00:00:00 2024\r\n');
        (0, vitest_1.expect)(pty.write).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('falls back to timeout when no prompt is detected', () => {
        const pty = createMockPty();
        const onTimeout = vitest_1.vi.fn();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
            timeoutMs: 5000,
            onTimeout,
        });
        pty.emit('Welcome to server\r\n');
        (0, vitest_1.expect)(pty.write).not.toHaveBeenCalled();
        vitest_1.vi.advanceTimersByTime(5000);
        (0, vitest_1.expect)(pty.write).toHaveBeenCalledWith('cd /foo\n');
        (0, vitest_1.expect)(onTimeout).toHaveBeenCalled();
    });
    (0, vitest_1.it)('uses default 15s timeout', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        vitest_1.vi.advanceTimersByTime(14999);
        (0, vitest_1.expect)(pty.write).not.toHaveBeenCalled();
        vitest_1.vi.advanceTimersByTime(1);
        (0, vitest_1.expect)(pty.write).toHaveBeenCalledWith('cd /foo\n');
    });
    (0, vitest_1.it)('only writes once even if multiple prompt chunks arrive', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        pty.emit('user@host:~$ ');
        pty.emit('user@host:~$ ');
        (0, vitest_1.expect)(pty.write).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('only writes once when prompt detected and then timeout fires', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
            timeoutMs: 1000,
        });
        pty.emit('user@host:~$ ');
        (0, vitest_1.expect)(pty.write).toHaveBeenCalledTimes(1);
        vitest_1.vi.advanceTimersByTime(1000);
        (0, vitest_1.expect)(pty.write).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('cleans up data listener after prompt detection', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        (0, vitest_1.expect)(pty.listenerCount()).toBe(1);
        pty.emit('user@host:~$ ');
        (0, vitest_1.expect)(pty.listenerCount()).toBe(0);
    });
    (0, vitest_1.it)('cleans up data listener after timeout', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
            timeoutMs: 1000,
        });
        (0, vitest_1.expect)(pty.listenerCount()).toBe(1);
        vitest_1.vi.advanceTimersByTime(1000);
        (0, vitest_1.expect)(pty.listenerCount()).toBe(0);
    });
    (0, vitest_1.it)('cancel() prevents writing and cleans up', () => {
        const pty = createMockPty();
        const handle = (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
            timeoutMs: 1000,
        });
        handle.cancel();
        pty.emit('user@host:~$ ');
        vitest_1.vi.advanceTimersByTime(1000);
        (0, vitest_1.expect)(pty.write).not.toHaveBeenCalled();
        (0, vitest_1.expect)(pty.listenerCount()).toBe(0);
    });
    (0, vitest_1.it)('is a no-op when data is empty', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: '',
        });
        (0, vitest_1.expect)(pty.listenerCount()).toBe(0);
        pty.emit('user@host:~$ ');
        (0, vitest_1.expect)(pty.write).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('does not match download progress ending with %', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        pty.emit('Downloading... 100%');
        (0, vitest_1.expect)(pty.write).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('does not match percentage in progress output', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        pty.emit('Progress: 50%');
        (0, vitest_1.expect)(pty.write).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('does not match dollar after digit', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        pty.emit('Total: 5$');
        (0, vitest_1.expect)(pty.write).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('detects prompt after multiple MOTD chunks', () => {
        const pty = createMockPty();
        (0, waitForShellPrompt_1.waitForShellPrompt)({
            subscribe: pty.subscribe,
            write: pty.write,
            data: 'cd /foo\n',
        });
        pty.emit('Welcome to Ubuntu 22.04.3 LTS (GNU/Linux 5.15.0)\r\n');
        pty.emit('\r\n');
        pty.emit(' * Documentation:  https://help.ubuntu.com\r\n');
        pty.emit(' * Management:     https://landscape.canonical.com\r\n');
        pty.emit('\r\n');
        pty.emit('Last login: Mon Mar 6 12:00:00 2026 from 10.0.0.1\r\n');
        (0, vitest_1.expect)(pty.write).not.toHaveBeenCalled();
        pty.emit('user@server:~$ ');
        (0, vitest_1.expect)(pty.write).toHaveBeenCalledWith('cd /foo\n');
    });
});
