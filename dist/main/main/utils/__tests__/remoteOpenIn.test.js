"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const remoteOpenIn_1 = require("../remoteOpenIn");
(0, vitest_1.describe)('buildRemoteSshAuthority', () => {
    (0, vitest_1.it)('prepends username when host has no user component', () => {
        (0, vitest_1.expect)((0, remoteOpenIn_1.buildRemoteSshAuthority)('example.internal', 'azureuser')).toBe('azureuser@example.internal');
    });
    (0, vitest_1.it)('preserves host when username is already embedded', () => {
        (0, vitest_1.expect)((0, remoteOpenIn_1.buildRemoteSshAuthority)('existing@example.internal', 'azureuser')).toBe('existing@example.internal');
    });
});
(0, vitest_1.describe)('buildRemoteEditorUrl', () => {
    (0, vitest_1.it)('builds cursor remote URL with encoded user@host authority', () => {
        (0, vitest_1.expect)((0, remoteOpenIn_1.buildRemoteEditorUrl)('cursor', 'example.internal', 'azureuser', '/home/azureuser/src')).toBe('cursor://vscode-remote/ssh-remote+azureuser%40example.internal/home/azureuser/src');
    });
    (0, vitest_1.it)('normalizes relative target paths with a leading slash', () => {
        (0, vitest_1.expect)((0, remoteOpenIn_1.buildRemoteEditorUrl)('vscode', 'example.internal', 'azureuser', 'workspace')).toBe('vscode://vscode-remote/ssh-remote+azureuser%40example.internal/workspace');
    });
});
(0, vitest_1.describe)('buildGhosttyRemoteExecArgs', () => {
    const expectedRemoteShellCommand = `cd '/home/azureuser/pro/smv/.emdash/worktrees/task one' && ` +
        '(if command -v infocmp >/dev/null 2>&1 && [ -n "${TERM:-}" ] && infocmp "${TERM}" >/dev/null 2>&1; then :; else export TERM=xterm-256color; fi) && ' +
        '(exec "${SHELL:-/bin/bash}" || exec /bin/bash || exec /bin/sh)';
    (0, vitest_1.it)('builds shared remote shell bootstrap command', () => {
        (0, vitest_1.expect)((0, remoteOpenIn_1.buildRemoteTerminalShellCommand)('/home/azureuser/pro/smv/.emdash/worktrees/task one')).toBe(expectedRemoteShellCommand);
    });
    (0, vitest_1.it)('builds ssh argv tokens for Ghostty -e', () => {
        (0, vitest_1.expect)((0, remoteOpenIn_1.buildGhosttyRemoteExecArgs)({
            host: 'example.internal',
            username: 'azureuser',
            port: 22,
            targetPath: '/home/azureuser/pro/smv/.emdash/worktrees/task one',
        })).toEqual([
            'ssh',
            'azureuser@example.internal',
            '-o',
            'ControlMaster=no',
            '-o',
            'ControlPath=none',
            '-p',
            '22',
            '-t',
            expectedRemoteShellCommand,
        ]);
    });
    (0, vitest_1.it)('preserves existing user@host authority', () => {
        (0, vitest_1.expect)((0, remoteOpenIn_1.buildGhosttyRemoteExecArgs)({
            host: 'ops@example.internal',
            username: 'ignored-user',
            port: '2202',
            targetPath: '/tmp/x',
        })).toEqual([
            'ssh',
            'ops@example.internal',
            '-o',
            'ControlMaster=no',
            '-o',
            'ControlPath=none',
            '-p',
            '2202',
            '-t',
            `cd '/tmp/x' && (if command -v infocmp >/dev/null 2>&1 && [ -n "\${TERM:-}" ] && infocmp "\${TERM}" >/dev/null 2>&1; then :; else export TERM=xterm-256color; fi) && (exec "\${SHELL:-/bin/bash}" || exec /bin/bash || exec /bin/sh)`,
        ]);
    });
    (0, vitest_1.it)('builds quoted ssh command string for shell-based launchers', () => {
        (0, vitest_1.expect)((0, remoteOpenIn_1.buildRemoteSshCommand)({
            host: 'example.internal',
            username: 'azureuser',
            port: 22,
            targetPath: '/home/azureuser/pro/smv/.emdash/worktrees/task one',
        })).toBe(`ssh 'azureuser@example.internal' -o 'ControlMaster=no' -o 'ControlPath=none' -p '22' -t '${expectedRemoteShellCommand.replace(/'/g, `'\\''`)}'`);
    });
    (0, vitest_1.it)('preserves existing user@host authority in shell command string', () => {
        (0, vitest_1.expect)((0, remoteOpenIn_1.buildRemoteSshCommand)({
            host: 'ops@example.internal',
            username: 'ignored-user',
            port: 22,
            targetPath: '/tmp/x',
        })).toContain(`ssh 'ops@example.internal'`);
    });
});
