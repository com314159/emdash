"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRemoteSshAuthority = buildRemoteSshAuthority;
exports.buildRemoteEditorUrl = buildRemoteEditorUrl;
exports.buildRemoteTerminalShellCommand = buildRemoteTerminalShellCommand;
exports.buildRemoteSshCommand = buildRemoteSshCommand;
exports.buildGhosttyRemoteExecArgs = buildGhosttyRemoteExecArgs;
const shellEscape_1 = require("./shellEscape");
function buildRemoteSshAuthority(host, username) {
    const normalizedHost = host.trim();
    if (!normalizedHost)
        return normalizedHost;
    // Keep host as-is when caller already included user info (for SSH aliases like user@host).
    if (normalizedHost.includes('@'))
        return normalizedHost;
    const normalizedUsername = username.trim();
    if (!normalizedUsername)
        return normalizedHost;
    return `${normalizedUsername}@${normalizedHost}`;
}
function buildRemoteEditorUrl(scheme, host, username, targetPath) {
    const authority = buildRemoteSshAuthority(host, username);
    const encodedAuthority = encodeURIComponent(authority);
    const normalizedTargetPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
    return `${scheme}://vscode-remote/ssh-remote+${encodedAuthority}${normalizedTargetPath}`;
}
/**
 * Shell payload executed on the remote host after SSH connects.
 *
 * Goals:
 * - always start in the requested directory
 * - preserve current TERM only when host supports it (fallback for missing terminfo)
 * - keep session alive even when SHELL is unset/invalid by chaining shell fallbacks
 */
function buildRemoteTerminalShellCommand(targetPath) {
    return `cd ${(0, shellEscape_1.quoteShellArg)(targetPath)} && (if command -v infocmp >/dev/null 2>&1 && [ -n "\${TERM:-}" ] && infocmp "\${TERM}" >/dev/null 2>&1; then :; else export TERM=xterm-256color; fi) && (exec "\${SHELL:-/bin/bash}" || exec /bin/bash || exec /bin/sh)`;
}
/**
 * Builds a single SSH command string for terminals that accept shell command text
 * (Terminal.app, iTerm2 via AppleScript, Warp URL cmd parameter).
 *
 * Command text is shell-escaped because these launchers execute through a shell.
 */
function buildRemoteSshCommand(input) {
    const sshAuthority = buildRemoteSshAuthority(input.host, input.username);
    const remoteCommand = buildRemoteTerminalShellCommand(input.targetPath);
    return `ssh ${(0, shellEscape_1.quoteShellArg)(sshAuthority)} -o ${(0, shellEscape_1.quoteShellArg)('ControlMaster=no')} -o ${(0, shellEscape_1.quoteShellArg)('ControlPath=none')} -p ${(0, shellEscape_1.quoteShellArg)(String(input.port))} -t ${(0, shellEscape_1.quoteShellArg)(remoteCommand)}`;
}
/**
 * Builds argv tokens for Ghostty `-e` remote SSH execution.
 *
 * We pass these tokens directly via child_process execFile/spawn (shell disabled),
 * so host/port are not shell-quoted here. The remote command itself is still
 * shell-escaped because it is parsed by the remote shell over SSH.
 */
function buildGhosttyRemoteExecArgs(input) {
    const sshAuthority = buildRemoteSshAuthority(input.host, input.username);
    const remoteCommand = buildRemoteTerminalShellCommand(input.targetPath);
    return [
        'ssh',
        sshAuthority,
        '-o',
        'ControlMaster=no',
        '-o',
        'ControlPath=none',
        '-p',
        String(input.port),
        '-t',
        remoteCommand,
    ];
}
