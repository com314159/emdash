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
exports.getStatus = getStatus;
exports.updateIndex = updateIndex;
exports.revertFile = revertFile;
exports.getFileDiff = getFileDiff;
exports.commit = commit;
exports.push = push;
exports.pull = pull;
exports.getLog = getLog;
exports.getLatestCommit = getLatestCommit;
exports.getCommitFiles = getCommitFiles;
exports.getCommitFileDiff = getCommitFileDiff;
exports.softResetLastCommit = softResetLastCommit;
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const diffParser_1 = require("../utils/diffParser");
const gitStatusParser_1 = require("../utils/gitStatusParser");
const diffShared_1 = require("./git-core/diffShared");
const indexShared_1 = require("./git-core/indexShared");
const revertShared_1 = require("./git-core/revertShared");
const statusShared_1 = require("./git-core/statusShared");
const workingTreeDiffShared_1 = require("./git-core/workingTreeDiffShared");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
const FORCE_LOAD_DIFF_CONTENT_BYTES = 5 * 1024 * 1024;
const FORCE_LOAD_DIFF_OUTPUT_BYTES = 30 * 1024 * 1024;
async function countFileNewlinesCapped(filePath, maxBytes) {
    let stat;
    try {
        stat = await fs.promises.stat(filePath);
    }
    catch {
        return null;
    }
    if (!stat.isFile() || stat.size > maxBytes) {
        return null;
    }
    return await new Promise((resolve) => {
        let count = 0;
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => {
            const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
            for (let i = 0; i < buffer.length; i++) {
                if (buffer[i] === 0x0a)
                    count++;
            }
        });
        stream.on('error', () => resolve(null));
        stream.on('end', () => resolve(count));
    });
}
async function readFileTextCapped(filePath, maxBytes) {
    let stat;
    try {
        stat = await fs.promises.stat(filePath);
    }
    catch {
        return { exists: false, tooLarge: false };
    }
    if (!stat.isFile()) {
        return { exists: false, tooLarge: false };
    }
    if (stat.size > maxBytes) {
        return { exists: true, tooLarge: true };
    }
    try {
        const contentBuffer = await fs.promises.readFile(filePath);
        if (contentBuffer.includes(0x00)) {
            return { exists: true, tooLarge: false, isBinary: true };
        }
        const content = contentBuffer.toString('utf8');
        return {
            exists: true,
            tooLarge: false,
            content: (0, diffParser_1.stripTrailingNewline)(content),
        };
    }
    catch {
        return { exists: true, tooLarge: false };
    }
}
async function readGitTextCapped(taskPath, objectSpec, maxBytes) {
    try {
        const { stdout: sizeStdout } = await execFileAsync('git', ['cat-file', '-s', objectSpec], {
            cwd: taskPath,
        });
        const size = parseInt(sizeStdout.trim(), 10);
        if (Number.isFinite(size) && size > maxBytes) {
            return { exists: true, tooLarge: true };
        }
    }
    catch {
        return { exists: false, tooLarge: false };
    }
    try {
        const { stdout } = (await execFileAsync('git', ['show', objectSpec], {
            cwd: taskPath,
            maxBuffer: maxBytes,
            encoding: 'buffer',
        }));
        if (stdout.includes(0x00)) {
            return { exists: true, tooLarge: false, isBinary: true };
        }
        return {
            exists: true,
            tooLarge: false,
            content: (0, diffParser_1.stripTrailingNewline)(stdout.toString('utf8')),
        };
    }
    catch (error) {
        if ((0, diffShared_1.isMaxBufferError)(error)) {
            return { exists: true, tooLarge: true };
        }
        return { exists: true, tooLarge: false };
    }
}
async function resolveReviewBaseRef(taskPath, baseRef) {
    try {
        const { stdout } = await execFileAsync('git', ['merge-base', baseRef, 'HEAD'], {
            cwd: taskPath,
        });
        const mergeBase = stdout.trim();
        if (mergeBase)
            return mergeBase;
    }
    catch {
        // Fall back to the requested base ref when merge-base cannot be resolved.
    }
    return baseRef;
}
async function getStatus(taskPath) {
    try {
        try {
            await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
                cwd: taskPath,
            });
        }
        catch {
            return [];
        }
        let statusOutput = '';
        try {
            const { stdout } = await execFileAsync('git', ['status', '--porcelain=v2', '-z', '--untracked-files=all'], {
                cwd: taskPath,
                maxBuffer: diffParser_1.MAX_DIFF_OUTPUT_BYTES,
            });
            statusOutput = stdout;
        }
        catch {
            // Fallback for older git versions that do not support porcelain v2.
            const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--untracked-files=all'], {
                cwd: taskPath,
                maxBuffer: diffParser_1.MAX_DIFF_OUTPUT_BYTES,
            });
            statusOutput = stdout;
        }
        if (!statusOutput.trim())
            return [];
        const entries = (0, gitStatusParser_1.parseGitStatusOutput)(statusOutput);
        const [stagedResult, unstagedResult] = await Promise.all([
            execFileAsync('git', ['diff', '--numstat', '--cached'], {
                cwd: taskPath,
                maxBuffer: diffParser_1.MAX_DIFF_OUTPUT_BYTES,
            }).catch(() => ({
                stdout: '',
                stderr: '',
            })),
            execFileAsync('git', ['diff', '--numstat'], {
                cwd: taskPath,
                maxBuffer: diffParser_1.MAX_DIFF_OUTPUT_BYTES,
            }).catch(() => ({
                stdout: '',
                stderr: '',
            })),
        ]);
        const stagedMap = (0, gitStatusParser_1.parseNumstatOutput)(stagedResult.stdout);
        const unstagedMap = (0, gitStatusParser_1.parseNumstatOutput)(unstagedResult.stdout);
        const { changes, untrackedPathsNeedingCounts } = (0, statusShared_1.buildStatusChanges)(entries, stagedMap, unstagedMap);
        if (untrackedPathsNeedingCounts.length === 0) {
            return changes;
        }
        const counts = await Promise.all(untrackedPathsNeedingCounts.map((filePath) => countFileNewlinesCapped(path.join(taskPath, filePath), statusShared_1.MAX_UNTRACKED_LINECOUNT_BYTES)));
        const untrackedMap = new Map();
        for (let i = 0; i < untrackedPathsNeedingCounts.length; i++) {
            untrackedMap.set(untrackedPathsNeedingCounts[i], counts[i] ?? null);
        }
        return (0, statusShared_1.applyUntrackedLineCounts)(changes, untrackedMap);
    }
    catch {
        return [];
    }
}
function normalizeLocalRelativeFilePath(taskPath, filePath) {
    const absPath = path.resolve(taskPath, filePath);
    const resolvedTaskPath = path.resolve(taskPath);
    if (!absPath.startsWith(resolvedTaskPath + path.sep) && absPath !== resolvedTaskPath) {
        throw new Error('File path is outside the worktree');
    }
    const relativePath = path.relative(resolvedTaskPath, absPath);
    const normalizedPath = relativePath.split(path.sep).join('/');
    if (!normalizedPath || normalizedPath === '.') {
        throw new Error('Invalid file path');
    }
    return normalizedPath;
}
async function updateIndex(taskPath, args) {
    await (0, indexShared_1.updateIndexShared)(args, {
        stageAll: async () => {
            await execFileAsync('git', ['add', '-A'], { cwd: taskPath });
        },
        resetAll: async () => {
            try {
                await execFileAsync('git', ['reset', 'HEAD', '--', '.'], { cwd: taskPath });
                return true;
            }
            catch {
                return false;
            }
        },
        listStagedPaths: async () => {
            const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only'], {
                cwd: taskPath,
            });
            return stdout
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);
        },
        stagePaths: async (filePaths) => {
            await execFileAsync('git', ['add', '--', ...filePaths], { cwd: taskPath });
        },
        resetPaths: async (filePaths) => {
            try {
                await execFileAsync('git', ['reset', 'HEAD', '--', ...filePaths], { cwd: taskPath });
                return true;
            }
            catch {
                return false;
            }
        },
        resetPath: async (filePath) => {
            try {
                await execFileAsync('git', ['reset', 'HEAD', '--', filePath], { cwd: taskPath });
                return true;
            }
            catch {
                return false;
            }
        },
        removePathFromIndex: async (filePath) => {
            await execFileAsync('git', ['rm', '--cached', '--', filePath], { cwd: taskPath });
        },
    });
}
async function revertFile(taskPath, filePath) {
    return (0, revertShared_1.revertFileShared)(filePath, {
        normalizeFilePath: (pathInput) => normalizeLocalRelativeFilePath(taskPath, pathInput),
        existsInHead: async (safePath) => {
            try {
                await execFileAsync('git', ['cat-file', '-e', `HEAD:${safePath}`], { cwd: taskPath });
                return true;
            }
            catch {
                return false;
            }
        },
        deleteUntracked: async (safePath) => {
            const absPath = path.resolve(taskPath, safePath);
            if (fs.existsSync(absPath)) {
                fs.unlinkSync(absPath);
            }
        },
        checkoutHead: async (safePath) => {
            try {
                await execFileAsync('git', ['checkout', 'HEAD', '--', safePath], { cwd: taskPath });
            }
            catch (error) {
                throw new Error(`Failed to revert file: ${error instanceof Error ? error.message : String(error)}`);
            }
        },
    });
}
async function getFileDiff(taskPath, filePath, baseRef, forceLarge) {
    const safeFilePath = normalizeLocalRelativeFilePath(taskPath, filePath);
    const diffContentLimit = forceLarge ? FORCE_LOAD_DIFF_CONTENT_BYTES : diffParser_1.MAX_DIFF_CONTENT_BYTES;
    const diffOutputLimit = forceLarge ? FORCE_LOAD_DIFF_OUTPUT_BYTES : diffParser_1.MAX_DIFF_OUTPUT_BYTES;
    const reviewBaseRef = baseRef ? await resolveReviewBaseRef(taskPath, baseRef) : undefined;
    const originalRef = reviewBaseRef || 'HEAD';
    // Helper: fetch content at the base ref with size guard
    const getOriginalContent = async () => {
        return readGitTextCapped(taskPath, `${originalRef}:${safeFilePath}`, diffContentLimit);
    };
    const getModifiedContent = async () => {
        if (baseRef) {
            return readGitTextCapped(taskPath, `HEAD:${safeFilePath}`, diffContentLimit);
        }
        return readFileTextCapped(path.join(taskPath, safeFilePath), diffContentLimit);
    };
    const [original, modified] = await Promise.all([getOriginalContent(), getModifiedContent()]);
    // Fast path: if we already know this file is binary or too large, skip expensive diff generation.
    if (original.isBinary || modified.isBinary) {
        return { lines: [], mode: 'binary', isBinary: true };
    }
    if (original.tooLarge || modified.tooLarge) {
        return (0, workingTreeDiffShared_1.resolveWorkingTreeDiffResult)({
            diffStdout: undefined,
            diffLines: [],
            hasHunk: false,
            diffTooLarge: true,
            diffFailed: false,
            original,
            modified,
        });
    }
    // Step 1: Run git diff
    let diffStdout;
    let diffTooLarge = false;
    let diffFailed = false;
    try {
        const diffArgs = baseRef
            ? ['diff', '--no-color', '--unified=2000', originalRef, 'HEAD', '--', safeFilePath]
            : ['diff', '--no-color', '--unified=2000', 'HEAD', '--', safeFilePath];
        const { stdout } = await execFileAsync('git', diffArgs, {
            cwd: taskPath,
            maxBuffer: diffOutputLimit,
        });
        diffStdout = stdout;
    }
    catch (error) {
        diffTooLarge = (0, diffShared_1.isMaxBufferError)(error);
        diffFailed = !diffTooLarge;
        // git diff failed (no HEAD, untracked file, etc.) — fall through to content-only path
    }
    // Step 2: Parse diff and check mode
    let diffLines = [];
    let hasHunk = false;
    if (diffStdout !== undefined) {
        const parsed = (0, diffParser_1.parseDiffLines)(diffStdout);
        if (parsed.isBinary) {
            return { lines: [], mode: 'binary', isBinary: true };
        }
        diffLines = parsed.lines;
        hasHunk = parsed.hasHunk;
    }
    return (0, workingTreeDiffShared_1.resolveWorkingTreeDiffResult)({
        diffStdout,
        diffLines,
        hasHunk,
        diffTooLarge,
        diffFailed,
        original,
        modified,
    });
}
/** Commit staged files (no push). Returns the commit hash. */
async function commit(taskPath, message) {
    if (!message || !message.trim()) {
        throw new Error('Commit message cannot be empty');
    }
    await execFileAsync('git', ['commit', '-m', message], { cwd: taskPath });
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: taskPath });
    return { hash: stdout.trim() };
}
/** Push current branch to origin. Sets upstream if needed. */
async function push(taskPath) {
    try {
        const { stdout } = await execFileAsync('git', ['push'], { cwd: taskPath });
        return { output: stdout.trim() };
    }
    catch (error) {
        const stderr = error?.stderr || '';
        // Only fallback to --set-upstream if git tells us there's no upstream
        if (stderr.includes('has no upstream branch') || stderr.includes('no upstream configured')) {
            const { stdout: branch } = await execFileAsync('git', ['branch', '--show-current'], {
                cwd: taskPath,
            });
            const { stdout } = await execFileAsync('git', ['push', '--set-upstream', 'origin', branch.trim()], { cwd: taskPath });
            return { output: stdout.trim() };
        }
        throw error;
    }
}
/** Pull from remote. */
async function pull(taskPath) {
    const { stdout } = await execFileAsync('git', ['pull'], { cwd: taskPath });
    return { output: stdout.trim() };
}
/** Get commit log for the current branch. */
async function getLog(taskPath, maxCount = 50, skip = 0, knownAheadCount) {
    // Use caller-provided aheadCount for pagination consistency, otherwise compute it.
    // Strategy: try upstream tracking branch first, then origin/<branch>, then origin/HEAD.
    // If none work, assume all commits are pushed (aheadCount = 0).
    let aheadCount = knownAheadCount ?? -1;
    if (aheadCount < 0) {
        aheadCount = 0;
        try {
            // Best case: branch has an upstream tracking ref
            const { stdout: countOut } = await execFileAsync('git', ['rev-list', '--count', '@{upstream}..HEAD'], { cwd: taskPath });
            aheadCount = parseInt(countOut.trim(), 10) || 0;
        }
        catch {
            try {
                // Fallback: compare against origin/<current-branch>
                const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: taskPath });
                const currentBranch = branchOut.trim();
                const { stdout: countOut } = await execFileAsync('git', ['rev-list', '--count', `origin/${currentBranch}..HEAD`], { cwd: taskPath });
                aheadCount = parseInt(countOut.trim(), 10) || 0;
            }
            catch {
                try {
                    // Last resort: compare against origin/HEAD (default branch)
                    const { stdout: defaultBranchOut } = await execFileAsync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: taskPath });
                    const defaultBranch = defaultBranchOut.trim();
                    const { stdout: countOut } = await execFileAsync('git', ['rev-list', '--count', `${defaultBranch}..HEAD`], { cwd: taskPath });
                    aheadCount = parseInt(countOut.trim(), 10) || 0;
                }
                catch {
                    // Cannot determine remote state (no remote, detached HEAD, offline, etc.)
                    // Default to 0 ahead so all commits show as pushed. This avoids false "unpushed"
                    // indicators when there's genuinely no remote to compare against.
                    aheadCount = 0;
                }
            }
        }
    }
    const FIELD_SEP = '---FIELD_SEP---';
    const RECORD_SEP = '---RECORD_SEP---';
    const format = `${RECORD_SEP}%H${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%D${FIELD_SEP}%ae${FIELD_SEP}%b`;
    const { stdout } = await execFileAsync('git', ['log', `--max-count=${maxCount}`, `--skip=${skip}`, `--pretty=format:${format}`, '--'], { cwd: taskPath });
    if (!stdout.trim())
        return { commits: [], aheadCount };
    const commits = stdout
        .split(RECORD_SEP)
        .filter((entry) => entry.trim())
        .map((entry, index) => {
        const parts = entry.trim().split(FIELD_SEP);
        // %D outputs ref decorations like "tag: v0.4.2, origin/main, HEAD -> main"
        const refs = parts[4] || '';
        const tags = refs
            .split(',')
            .map((r) => r.trim())
            .filter((r) => r.startsWith('tag: '))
            .map((r) => r.slice(5));
        return {
            hash: parts[0] || '',
            subject: parts[1] || '',
            body: (parts[6] || '').trim(),
            author: parts[2] || '',
            authorEmail: parts[5] || '',
            date: parts[3] || '',
            isPushed: skip + index >= aheadCount,
            tags,
        };
    });
    return { commits, aheadCount };
}
/** Get the latest commit info (subject + body). */
async function getLatestCommit(taskPath) {
    const { commits } = await getLog(taskPath, 1);
    return commits[0] || null;
}
/** Get files changed in a specific commit. */
async function getCommitFiles(taskPath, commitHash) {
    // Use --root to handle initial commits (no parent) and
    // -m --first-parent to handle merge commits (compare against first parent only)
    const { stdout } = await execFileAsync('git', [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '-r',
        '-m',
        '--first-parent',
        '--numstat',
        commitHash,
    ], { cwd: taskPath });
    const { stdout: nameStatus } = await execFileAsync('git', [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '-r',
        '-m',
        '--first-parent',
        '--name-status',
        commitHash,
    ], { cwd: taskPath });
    const statLines = stdout.trim().split('\n').filter(Boolean);
    const statusLines = nameStatus.trim().split('\n').filter(Boolean);
    const statusMap = new Map();
    for (const line of statusLines) {
        const [code, ...pathParts] = line.split('\t');
        const filePath = pathParts[pathParts.length - 1] || '';
        const status = code === 'A'
            ? 'added'
            : code === 'D'
                ? 'deleted'
                : code?.startsWith('R')
                    ? 'renamed'
                    : 'modified';
        statusMap.set(filePath, status);
    }
    return statLines.map((line) => {
        const [addStr, delStr, ...pathParts] = line.split('\t');
        const filePath = pathParts.join('\t');
        return {
            path: filePath,
            status: statusMap.get(filePath) || 'modified',
            additions: addStr === '-' ? 0 : parseInt(addStr || '0', 10) || 0,
            deletions: delStr === '-' ? 0 : parseInt(delStr || '0', 10) || 0,
        };
    });
}
/** Get diff for a specific file in a specific commit. */
async function getCommitFileDiff(taskPath, commitHash, filePath, forceLarge) {
    const safeFilePath = normalizeLocalRelativeFilePath(taskPath, filePath);
    const diffContentLimit = forceLarge ? FORCE_LOAD_DIFF_CONTENT_BYTES : diffParser_1.MAX_DIFF_CONTENT_BYTES;
    const diffOutputLimit = forceLarge ? FORCE_LOAD_DIFF_OUTPUT_BYTES : diffParser_1.MAX_DIFF_OUTPUT_BYTES;
    // Helper: fetch content at a given ref with size guard
    const getContentAt = async (ref) => {
        return readGitTextCapped(taskPath, `${ref}:${safeFilePath}`, diffContentLimit);
    };
    // Check if this is a root commit (no parent)
    let hasParent = true;
    try {
        await execFileAsync('git', ['rev-parse', '--verify', `${commitHash}~1`], { cwd: taskPath });
    }
    catch {
        hasParent = false;
    }
    if (!hasParent) {
        const modified = await getContentAt(commitHash);
        const modifiedContent = modified.content;
        if (modified.isBinary) {
            const result = { lines: [], mode: 'binary', isBinary: true };
            return result;
        }
        if (modified.tooLarge) {
            const result = { lines: [], mode: 'largeText' };
            return result;
        }
        if (modifiedContent === undefined) {
            const result = { lines: [], mode: 'unrenderable' };
            return result;
        }
        if (modifiedContent === '') {
            const result = { lines: [], mode: 'text', modifiedContent };
            return result;
        }
        const lines = (0, diffShared_1.buildAddedDiffLines)(modifiedContent);
        const result = {
            lines,
            mode: 'text',
            modifiedContent,
            warnings: (0, diffShared_1.buildOptionalDiffWarnings)(undefined, modifiedContent, lines),
        };
        return result;
    }
    const [original, modified] = await Promise.all([
        getContentAt(`${commitHash}~1`),
        getContentAt(commitHash),
    ]);
    if (original.isBinary || modified.isBinary) {
        const result = { lines: [], mode: 'binary', isBinary: true };
        return result;
    }
    if (original.tooLarge || modified.tooLarge) {
        const originalContent = original.content;
        const modifiedContent = modified.content;
        const result = {
            lines: [],
            mode: 'largeText',
            originalContent,
            modifiedContent,
            warnings: (0, diffShared_1.buildOptionalDiffWarnings)(originalContent, modifiedContent, []),
        };
        return result;
    }
    // Run diff
    let diffStdout;
    let diffTooLarge = false;
    let diffFailed = false;
    try {
        const { stdout } = await execFileAsync('git', ['diff', '--no-color', '--unified=2000', `${commitHash}~1`, commitHash, '--', safeFilePath], { cwd: taskPath, maxBuffer: diffOutputLimit });
        diffStdout = stdout;
    }
    catch (error) {
        diffTooLarge = (0, diffShared_1.isMaxBufferError)(error);
        diffFailed = !diffTooLarge;
        // diff too large or git error — fall through to content-only path
    }
    let diffLines = [];
    let hasHunk = false;
    if (diffStdout !== undefined) {
        const { lines, isBinary, hasHunk: parsedHasHunk } = (0, diffParser_1.parseDiffLines)(diffStdout);
        if (isBinary) {
            const result = { lines: [], mode: 'binary', isBinary: true };
            return result;
        }
        diffLines = lines;
        hasHunk = parsedHasHunk;
    }
    const originalContent = original.content;
    const modifiedContent = modified.content;
    const warnings = (0, diffShared_1.buildOptionalDiffWarnings)(originalContent, modifiedContent, diffLines);
    if (diffTooLarge || original.tooLarge || modified.tooLarge) {
        const result = {
            lines: diffLines,
            mode: 'largeText',
            originalContent,
            modifiedContent,
            warnings,
        };
        return result;
    }
    if (diffLines.length > 0) {
        const result = {
            lines: diffLines,
            mode: 'text',
            originalContent,
            modifiedContent,
            warnings,
        };
        return result;
    }
    if (!hasHunk && diffStdout !== undefined && diffStdout.trim()) {
        const result = {
            lines: [],
            mode: 'unrenderable',
            originalContent,
            modifiedContent,
            warnings: (0, diffShared_1.buildOptionalDiffWarnings)(originalContent, modifiedContent, []),
        };
        return result;
    }
    // Fallback: diff failed or empty — determine from content
    if (modifiedContent !== undefined && modifiedContent !== '') {
        const lines = (0, diffShared_1.buildAddedDiffLines)(modifiedContent);
        const result = {
            lines,
            mode: 'text',
            originalContent,
            modifiedContent,
            warnings: (0, diffShared_1.buildOptionalDiffWarnings)(originalContent, modifiedContent, lines),
        };
        return result;
    }
    if (originalContent !== undefined) {
        const lines = (0, diffShared_1.buildDeletedDiffLines)(originalContent);
        const result = {
            lines,
            mode: 'text',
            originalContent,
            modifiedContent,
            warnings: (0, diffShared_1.buildOptionalDiffWarnings)(originalContent, modifiedContent, lines),
        };
        return result;
    }
    const fallbackMode = diffFailed ? 'unrenderable' : 'text';
    const result = {
        lines: [],
        mode: fallbackMode,
        originalContent,
        modifiedContent,
    };
    return result;
}
/** Soft-reset the latest commit. Returns the commit message that was reset. */
async function softResetLastCommit(taskPath) {
    // Check if HEAD~1 exists (i.e., this isn't the initial commit)
    try {
        await execFileAsync('git', ['rev-parse', '--verify', 'HEAD~1'], { cwd: taskPath });
    }
    catch {
        throw new Error('Cannot undo the initial commit');
    }
    // Check if the commit has been pushed (safety guard — UI also hides the button)
    const { commits: log } = await getLog(taskPath, 1);
    if (log[0]?.isPushed) {
        throw new Error('Cannot undo a commit that has already been pushed');
    }
    const { stdout: subject } = await execFileAsync('git', ['log', '-1', '--pretty=format:%s'], {
        cwd: taskPath,
    });
    const { stdout: body } = await execFileAsync('git', ['log', '-1', '--pretty=format:%b'], {
        cwd: taskPath,
    });
    await execFileAsync('git', ['reset', '--soft', 'HEAD~1'], { cwd: taskPath });
    return { subject: subject.trim(), body: body.trim() };
}
