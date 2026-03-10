"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quoteShellArg = quoteShellArg;
exports.isValidEnvVarName = isValidEnvVarName;
/**
 * Shared POSIX shell escaping utility.
 *
 * Uses single-quote wrapping, which prevents all variable expansion,
 * command substitution, and globbing. Embedded single quotes are handled
 * by ending the quoted region, inserting an escaped single quote, and
 * re-opening the quoted region.
 */
function quoteShellArg(arg) {
    return `'${arg.replace(/'/g, "'\\''")}'`;
}
/**
 * Validates that a string is a safe POSIX environment variable name.
 * Must start with a letter or underscore, followed by letters, digits, or underscores.
 */
function isValidEnvVarName(name) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
