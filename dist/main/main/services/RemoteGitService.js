"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteGitService = void 0;
const shellEscape_1 = require("../utils/shellEscape");
const diffParser_1 = require("../utils/diffParser");
const gitStatusParser_1 = require("../utils/gitStatusParser");
const indexShared_1 = require("./git-core/indexShared");
const remoteTaggedContent_1 = require("./git-core/remoteTaggedContent");
const revertShared_1 = require("./git-core/revertShared");
const statusShared_1 = require("./git-core/statusShared");
const workingTreeDiffShared_1 = require("./git-core/workingTreeDiffShared");
class RemoteGitService {
    constructor(sshService) {
        this.sshService = sshService;
    }
    normalizeRemotePath(p) {
        // Remote paths should use forward slashes.
        return p.replace(/\\/g, '/').replace(/\/+$/g, '');
    }
    ensureSafeRelativeFilePath(filePath) {
        const normalized = filePath
            .replace(/\\/g, '/')
            .replace(/^\.\/+/, '')
            .replace(/\/+/g, '/');
        if (!normalized || normalized === '.' || normalized.includes('\0')) {
            throw new Error('Invalid file path');
        }
        if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
            throw new Error('File path is outside the worktree');
        }
        if (normalized.split('/').includes('..')) {
            throw new Error('File path is outside the worktree');
        }
        return normalized;
    }
    async resolveReviewBaseRef(connectionId, cwd, baseRef) {
        const mergeBaseResult = await this.sshService.executeCommand(connectionId, `git merge-base ${(0, shellEscape_1.quoteShellArg)(baseRef)} HEAD`, cwd);
        const mergeBase = (mergeBaseResult.stdout || '').trim();
        return mergeBaseResult.exitCode === 0 && mergeBase ? mergeBase : baseRef;
    }
    async getStatus(connectionId, worktreePath) {
        const cwd = this.normalizeRemotePath(worktreePath);
        const result = await this.sshService.executeCommand(connectionId, 'git status --porcelain -b', cwd);
        if (result.exitCode !== 0) {
            throw new Error(`Git status failed: ${result.stderr}`);
        }
        const lines = result.stdout.split('\n');
        const branchLine = lines[0];
        const files = lines.slice(1).filter((l) => l.trim());
        const branchMatch = branchLine.match(/^## (.+?)(?:\...|$)/);
        const branch = branchMatch ? branchMatch[1] : 'unknown';
        return {
            branch,
            isClean: files.length === 0,
            files: files.map((line) => ({
                status: line.substring(0, 2).trim(),
                path: line.substring(3),
            })),
        };
    }
    async getDefaultBranch(connectionId, projectPath) {
        const normalizedProjectPath = this.normalizeRemotePath(projectPath);
        // Try to get the current branch
        const currentBranchResult = await this.sshService.executeCommand(connectionId, 'git rev-parse --abbrev-ref HEAD', normalizedProjectPath);
        if (currentBranchResult.exitCode === 0 &&
            currentBranchResult.stdout.trim() &&
            currentBranchResult.stdout.trim() !== 'HEAD') {
            return currentBranchResult.stdout.trim();
        }
        // Fallback: check common default branch names
        const commonBranches = ['main', 'master', 'develop', 'trunk'];
        for (const branch of commonBranches) {
            const checkResult = await this.sshService.executeCommand(connectionId, `git rev-parse --verify ${(0, shellEscape_1.quoteShellArg)(branch)} 2>/dev/null`, normalizedProjectPath);
            if (checkResult.exitCode === 0) {
                return branch;
            }
        }
        return 'HEAD';
    }
    async createWorktree(connectionId, projectPath, taskName, baseRef) {
        const normalizedProjectPath = this.normalizeRemotePath(projectPath);
        const slug = taskName
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        const worktreeName = `${slug || 'task'}-${Date.now()}`;
        const relWorktreePath = `.emdash/worktrees/${worktreeName}`;
        const worktreePath = `${normalizedProjectPath}/${relWorktreePath}`.replace(/\/+/g, '/');
        // Create worktrees directory (relative so we avoid quoting issues)
        await this.sshService.executeCommand(connectionId, 'mkdir -p .emdash/worktrees', normalizedProjectPath);
        // Auto-detect default branch if baseRef is not provided or is invalid
        let base = (baseRef || '').trim();
        // If no base provided, use auto-detection
        if (!base) {
            base = await this.getDefaultBranch(connectionId, normalizedProjectPath);
        }
        else {
            // Always verify the provided branch exists, regardless of what it is
            const verifyResult = await this.sshService.executeCommand(connectionId, `git rev-parse --verify ${(0, shellEscape_1.quoteShellArg)(base)} 2>/dev/null`, normalizedProjectPath);
            if (verifyResult.exitCode !== 0) {
                // Branch doesn't exist, auto-detect the actual default branch
                base = await this.getDefaultBranch(connectionId, normalizedProjectPath);
            }
        }
        if (!base) {
            base = 'HEAD';
        }
        const result = await this.sshService.executeCommand(connectionId, `git worktree add ${(0, shellEscape_1.quoteShellArg)(relWorktreePath)} -b ${(0, shellEscape_1.quoteShellArg)(worktreeName)} ${(0, shellEscape_1.quoteShellArg)(base)}`, normalizedProjectPath);
        if (result.exitCode !== 0) {
            throw new Error(`Failed to create worktree: ${result.stderr}`);
        }
        return {
            path: worktreePath,
            branch: worktreeName,
            isMain: false,
        };
    }
    async removeWorktree(connectionId, projectPath, worktreePath) {
        const normalizedProjectPath = this.normalizeRemotePath(projectPath);
        const normalizedWorktreePath = this.normalizeRemotePath(worktreePath);
        const result = await this.sshService.executeCommand(connectionId, `git worktree remove ${(0, shellEscape_1.quoteShellArg)(normalizedWorktreePath)} --force`, normalizedProjectPath);
        if (result.exitCode !== 0) {
            throw new Error(`Failed to remove worktree: ${result.stderr}`);
        }
    }
    async listWorktrees(connectionId, projectPath) {
        const normalizedProjectPath = this.normalizeRemotePath(projectPath);
        const result = await this.sshService.executeCommand(connectionId, 'git worktree list --porcelain', normalizedProjectPath);
        if (result.exitCode !== 0) {
            throw new Error(`Failed to list worktrees: ${result.stderr}`);
        }
        // Porcelain output is blocks separated by blank lines.
        // Each block begins with: worktree <path>
        // Optional: branch <ref>
        // Optional: detached
        const blocks = result.stdout
            .split(/\n\s*\n/g)
            .map((b) => b.trim())
            .filter(Boolean);
        const out = [];
        for (const block of blocks) {
            const lines = block.split('\n').map((l) => l.trim());
            const wtLine = lines.find((l) => l.startsWith('worktree '));
            if (!wtLine)
                continue;
            const wtPath = wtLine.slice('worktree '.length).trim();
            const branchLine = lines.find((l) => l.startsWith('branch '));
            const branchRef = branchLine ? branchLine.slice('branch '.length).trim() : '';
            const branch = branchRef.replace(/^refs\/heads\//, '') || 'HEAD';
            const isMain = this.normalizeRemotePath(wtPath) === normalizedProjectPath;
            out.push({ path: wtPath, branch, isMain });
        }
        return out;
    }
    async getWorktreeStatus(connectionId, worktreePath) {
        const normalizedWorktreePath = this.normalizeRemotePath(worktreePath);
        const result = await this.sshService.executeCommand(connectionId, 'git status --porcelain --untracked-files=all', normalizedWorktreePath);
        if (result.exitCode !== 0) {
            throw new Error(`Git status failed: ${result.stderr}`);
        }
        const stagedFiles = [];
        const unstagedFiles = [];
        const untrackedFiles = [];
        const entries = (0, gitStatusParser_1.parseGitStatusOutput)(result.stdout || '');
        for (const entry of entries) {
            if (entry.isStaged) {
                stagedFiles.push(entry.path);
            }
            const worktreeStatus = entry.statusCode.padEnd(2, '.')[1];
            if (worktreeStatus !== '.' && worktreeStatus !== ' ' && worktreeStatus !== '?') {
                unstagedFiles.push(entry.path);
            }
            if (entry.statusCode.includes('?')) {
                untrackedFiles.push(entry.path);
            }
        }
        return {
            hasChanges: stagedFiles.length > 0 || unstagedFiles.length > 0 || untrackedFiles.length > 0,
            stagedFiles,
            unstagedFiles,
            untrackedFiles,
        };
    }
    async getBranchList(connectionId, projectPath) {
        const result = await this.sshService.executeCommand(connectionId, 'git branch -a --format="%(refname:short)"', this.normalizeRemotePath(projectPath));
        if (result.exitCode !== 0) {
            return [];
        }
        return result.stdout.split('\n').filter((b) => b.trim());
    }
    async commit(connectionId, worktreePath, message, files) {
        let command = 'git commit';
        if (files && files.length > 0) {
            const fileList = files.map((f) => (0, shellEscape_1.quoteShellArg)(f)).join(' ');
            command = `git add ${fileList} && ${command}`;
        }
        command += ` -m ${(0, shellEscape_1.quoteShellArg)(message)}`;
        return this.sshService.executeCommand(connectionId, command, this.normalizeRemotePath(worktreePath));
    }
    // ---------------------------------------------------------------------------
    // Git operations for IPC parity with local GitService
    // ---------------------------------------------------------------------------
    /**
     * Detailed git status matching the shape returned by local GitService.getStatus().
     * Parses porcelain output, numstat diffs, and untracked file line counts.
     */
    async getStatusDetailed(connectionId, worktreePath) {
        const cwd = this.normalizeRemotePath(worktreePath);
        // Verify git repo
        const verifyResult = await this.sshService.executeCommand(connectionId, 'git rev-parse --is-inside-work-tree', cwd);
        if (verifyResult.exitCode !== 0) {
            return [];
        }
        let statusOutput = '';
        const statusV2Result = await this.sshService.executeCommand(connectionId, 'git status --porcelain=v2 -z --untracked-files=all', cwd);
        if (statusV2Result.exitCode === 0) {
            statusOutput = statusV2Result.stdout || '';
        }
        else {
            // Fallback for older remote git versions.
            const statusV1Result = await this.sshService.executeCommand(connectionId, 'git status --porcelain --untracked-files=all', cwd);
            if (statusV1Result.exitCode !== 0) {
                const stderr = (statusV1Result.stderr || statusV2Result.stderr || '').trim();
                throw new Error(stderr || 'Failed to read git status');
            }
            statusOutput = statusV1Result.stdout || '';
        }
        if (!statusOutput.trim())
            return [];
        const entries = (0, gitStatusParser_1.parseGitStatusOutput)(statusOutput);
        // Batch-fetch numstat for staged and unstaged changes (one SSH call each, not per-file)
        const [stagedNumstat, unstagedNumstat] = await Promise.all([
            this.sshService.executeCommand(connectionId, 'git diff --numstat --cached', cwd),
            this.sshService.executeCommand(connectionId, 'git diff --numstat', cwd),
        ]);
        const stagedStats = (0, gitStatusParser_1.parseNumstatOutput)(stagedNumstat.stdout || '');
        const unstagedStats = (0, gitStatusParser_1.parseNumstatOutput)(unstagedNumstat.stdout || '');
        const { changes, untrackedPathsNeedingCounts } = (0, statusShared_1.buildStatusChanges)(entries, stagedStats, unstagedStats);
        // Batch line-count for untracked files (skip files > 512KB)
        if (untrackedPathsNeedingCounts.length === 0) {
            return changes;
        }
        const escaped = untrackedPathsNeedingCounts
            .map((filePath) => (0, shellEscape_1.quoteShellArg)(filePath))
            .join(' ');
        // For each file: if <= 512KB, count newlines; otherwise print -1
        const script = `for f in ${escaped}; do ` +
            `s=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null); ` +
            `if [ "$s" -le ${statusShared_1.MAX_UNTRACKED_LINECOUNT_BYTES} ] 2>/dev/null; then ` +
            `wc -l < "$f" 2>/dev/null || echo -1; ` +
            `else echo -1; fi; done`;
        const countResult = await this.sshService.executeCommand(connectionId, script, cwd);
        if (countResult.exitCode !== 0) {
            return changes;
        }
        const parsedCounts = (countResult.stdout || '')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        const untrackedCountByPath = new Map();
        for (let i = 0; i < untrackedPathsNeedingCounts.length; i++) {
            const countValue = parsedCounts[i];
            if (countValue === undefined) {
                untrackedCountByPath.set(untrackedPathsNeedingCounts[i], null);
                continue;
            }
            const count = Number.parseInt(countValue, 10);
            untrackedCountByPath.set(untrackedPathsNeedingCounts[i], Number.isFinite(count) && count >= 0 ? count : null);
        }
        return (0, statusShared_1.applyUntrackedLineCounts)(changes, untrackedCountByPath);
    }
    /**
     * Per-file diff matching the shape returned by local GitService.getFileDiff().
     */
    async getFileDiff(connectionId, worktreePath, filePath, baseRef, forceLarge) {
        const cwd = this.normalizeRemotePath(worktreePath);
        const safeFilePath = this.ensureSafeRelativeFilePath(filePath);
        const diffContentLimit = forceLarge
            ? RemoteGitService.FORCE_LOAD_DIFF_CONTENT_BYTES
            : diffParser_1.MAX_DIFF_CONTENT_BYTES;
        const diffOutputLimit = forceLarge
            ? RemoteGitService.FORCE_LOAD_DIFF_OUTPUT_BYTES
            : diffParser_1.MAX_DIFF_OUTPUT_BYTES;
        const reviewBaseRef = baseRef
            ? await this.resolveReviewBaseRef(connectionId, cwd, baseRef)
            : undefined;
        const originalRef = reviewBaseRef || 'HEAD';
        const readGitObjectTextCapped = async (objectSpec) => {
            const result = await this.sshService.executeCommand(connectionId, `if git cat-file -e ${(0, shellEscape_1.quoteShellArg)(objectSpec)} 2>/dev/null; then ` +
                `s=$(git cat-file -s ${(0, shellEscape_1.quoteShellArg)(objectSpec)} 2>/dev/null); ` +
                `if [ "$s" -le ${diffContentLimit} ] 2>/dev/null; then ` +
                `printf "__EMDASH_CONTENT__\\n"; git show ${(0, shellEscape_1.quoteShellArg)(objectSpec)}; ` +
                `else echo "__EMDASH_TOO_LARGE__"; fi; ` +
                `else echo "__EMDASH_MISSING__"; fi`, cwd);
            return (0, remoteTaggedContent_1.parseTaggedRemoteContent)(result);
        };
        const readWorkingFileTextCapped = async (remoteFilePath) => {
            const result = await this.sshService.executeCommand(connectionId, `if [ -f ${(0, shellEscape_1.quoteShellArg)(remoteFilePath)} ]; then ` +
                `s=$(stat -c%s ${(0, shellEscape_1.quoteShellArg)(remoteFilePath)} 2>/dev/null || stat -f%z ${(0, shellEscape_1.quoteShellArg)(remoteFilePath)} 2>/dev/null); ` +
                `if [ "$s" -le ${diffContentLimit} ] 2>/dev/null; then ` +
                `printf "__EMDASH_CONTENT__\\n"; cat ${(0, shellEscape_1.quoteShellArg)(remoteFilePath)}; ` +
                `else echo "__EMDASH_TOO_LARGE__"; fi; ` +
                `else echo "__EMDASH_MISSING__"; fi`, cwd);
            return (0, remoteTaggedContent_1.parseTaggedRemoteContent)(result);
        };
        const getOriginalContent = async () => {
            return readGitObjectTextCapped(`${originalRef}:${safeFilePath}`);
        };
        const getModifiedContent = async () => {
            if (baseRef) {
                return readGitObjectTextCapped(`HEAD:${safeFilePath}`);
            }
            return readWorkingFileTextCapped(safeFilePath);
        };
        const [original, modified] = await Promise.all([getOriginalContent(), getModifiedContent()]);
        // Fast path: if content probe already indicates binary/oversized file, skip full git diff.
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
        let diffLines = [];
        let hasHunk = false;
        const diffCommand = baseRef
            ? `git diff --no-color --unified=2000 ${(0, shellEscape_1.quoteShellArg)(originalRef)} HEAD -- ${(0, shellEscape_1.quoteShellArg)(safeFilePath)}`
            : `git diff --no-color --unified=2000 HEAD -- ${(0, shellEscape_1.quoteShellArg)(safeFilePath)}`;
        const diffResult = await this.sshService.executeCommand(connectionId, diffCommand, cwd);
        if (diffResult.exitCode === 0) {
            diffStdout = diffResult.stdout || '';
            diffTooLarge = Buffer.byteLength(diffStdout, 'utf8') > diffOutputLimit;
            if (diffStdout.trim()) {
                const likelyBinary = diffStdout.includes('Binary files ') || diffStdout.includes('GIT binary patch');
                if (likelyBinary) {
                    return { lines: [], mode: 'binary', isBinary: true };
                }
                if (!diffTooLarge) {
                    const parsed = (0, diffParser_1.parseDiffLines)(diffStdout);
                    if (parsed.isBinary) {
                        return { lines: [], mode: 'binary', isBinary: true };
                    }
                    diffLines = parsed.lines;
                    hasHunk = parsed.hasHunk;
                }
            }
        }
        else {
            diffFailed = true;
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
    async updateIndex(connectionId, worktreePath, args) {
        const cwd = this.normalizeRemotePath(worktreePath);
        await (0, indexShared_1.updateIndexShared)(args, {
            stageAll: async () => {
                const result = await this.sshService.executeCommand(connectionId, 'git add -A', cwd);
                if (result.exitCode !== 0) {
                    throw new Error(`Failed to stage all files: ${result.stderr}`);
                }
            },
            resetAll: async () => {
                const result = await this.sshService.executeCommand(connectionId, 'git reset HEAD -- .', cwd);
                return result.exitCode === 0;
            },
            listStagedPaths: async () => {
                const stagedResult = await this.sshService.executeCommand(connectionId, 'git diff --cached --name-only', cwd);
                return (stagedResult.stdout || '')
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean);
            },
            stagePaths: async (filePaths) => {
                const files = filePaths.map((filePath) => (0, shellEscape_1.quoteShellArg)(filePath)).join(' ');
                const result = await this.sshService.executeCommand(connectionId, `git add -- ${files}`, cwd);
                if (result.exitCode !== 0) {
                    throw new Error(`Failed to stage files: ${result.stderr}`);
                }
            },
            resetPaths: async (filePaths) => {
                const files = filePaths.map((filePath) => (0, shellEscape_1.quoteShellArg)(filePath)).join(' ');
                const result = await this.sshService.executeCommand(connectionId, `git reset HEAD -- ${files}`, cwd);
                return result.exitCode === 0;
            },
            resetPath: async (filePath) => {
                const result = await this.sshService.executeCommand(connectionId, `git reset HEAD -- ${(0, shellEscape_1.quoteShellArg)(filePath)}`, cwd);
                return result.exitCode === 0;
            },
            removePathFromIndex: async (filePath) => {
                const fallback = await this.sshService.executeCommand(connectionId, `git rm --cached -- ${(0, shellEscape_1.quoteShellArg)(filePath)}`, cwd);
                if (fallback.exitCode !== 0) {
                    throw new Error(`Failed to unstage file: ${fallback.stderr}`);
                }
            },
        });
    }
    async revertFile(connectionId, worktreePath, filePath) {
        const cwd = this.normalizeRemotePath(worktreePath);
        return (0, revertShared_1.revertFileShared)(filePath, {
            normalizeFilePath: (pathInput) => this.ensureSafeRelativeFilePath(pathInput),
            existsInHead: async (safePath) => {
                const catFileResult = await this.sshService.executeCommand(connectionId, `git cat-file -e HEAD:${(0, shellEscape_1.quoteShellArg)(safePath)}`, cwd);
                return catFileResult.exitCode === 0;
            },
            deleteUntracked: async (safePath) => {
                await this.sshService.executeCommand(connectionId, `rm -f -- ${(0, shellEscape_1.quoteShellArg)(safePath)}`, cwd);
            },
            checkoutHead: async (safePath) => {
                const checkoutResult = await this.sshService.executeCommand(connectionId, `git checkout HEAD -- ${(0, shellEscape_1.quoteShellArg)(safePath)}`, cwd);
                if (checkoutResult.exitCode !== 0) {
                    throw new Error(`Failed to revert file: ${checkoutResult.stderr}`);
                }
            },
        });
    }
    // ---------------------------------------------------------------------------
    // Commit, push, and branch operations
    // ---------------------------------------------------------------------------
    async getCurrentBranch(connectionId, worktreePath) {
        const cwd = this.normalizeRemotePath(worktreePath);
        const result = await this.sshService.executeCommand(connectionId, 'git branch --show-current', cwd);
        return (result.stdout || '').trim();
    }
    /**
     * Detect the default branch name using the remote HEAD or common conventions.
     * Unlike getDefaultBranch(), this specifically queries origin's default (not current branch).
     */
    async getDefaultBranchName(connectionId, worktreePath) {
        const cwd = this.normalizeRemotePath(worktreePath);
        // Try gh CLI first
        const ghResult = await this.sshService.executeCommand(connectionId, 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null', cwd);
        if (ghResult.exitCode === 0 && ghResult.stdout.trim()) {
            return ghResult.stdout.trim();
        }
        // Fallback: parse git remote show origin
        const remoteResult = await this.sshService.executeCommand(connectionId, 'git remote show origin 2>/dev/null | sed -n "/HEAD branch/s/.*: //p"', cwd);
        if (remoteResult.exitCode === 0 && remoteResult.stdout.trim()) {
            return remoteResult.stdout.trim();
        }
        // Fallback: symbolic-ref
        const symrefResult = await this.sshService.executeCommand(connectionId, 'git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null', cwd);
        if (symrefResult.exitCode === 0 && symrefResult.stdout.trim()) {
            const parts = symrefResult.stdout.trim().split('/');
            return parts[parts.length - 1];
        }
        return 'main';
    }
    async createBranch(connectionId, worktreePath, name) {
        const cwd = this.normalizeRemotePath(worktreePath);
        const result = await this.sshService.executeCommand(connectionId, `git checkout -b ${(0, shellEscape_1.quoteShellArg)(name)}`, cwd);
        if (result.exitCode !== 0) {
            throw new Error(`Failed to create branch: ${result.stderr}`);
        }
    }
    async push(connectionId, worktreePath, branch, setUpstream) {
        const cwd = this.normalizeRemotePath(worktreePath);
        let cmd = 'git push';
        if (setUpstream && branch) {
            cmd = `git push --set-upstream origin ${(0, shellEscape_1.quoteShellArg)(branch)}`;
        }
        return this.sshService.executeCommand(connectionId, cmd, cwd);
    }
    async getBranchStatus(connectionId, worktreePath) {
        const cwd = this.normalizeRemotePath(worktreePath);
        const branch = await this.getCurrentBranch(connectionId, worktreePath);
        const defaultBranch = await this.getDefaultBranchName(connectionId, worktreePath);
        let ahead = 0;
        let behind = 0;
        const compareRef = `origin/${defaultBranch}...HEAD`;
        const revListResult = await this.sshService.executeCommand(connectionId, `git rev-list --left-right --count ${(0, shellEscape_1.quoteShellArg)(compareRef)} 2>/dev/null`, cwd);
        if (revListResult.exitCode === 0) {
            const parts = (revListResult.stdout || '').trim().split(/\s+/);
            if (parts.length >= 2) {
                behind = parseInt(parts[0] || '0', 10) || 0;
                ahead = parseInt(parts[1] || '0', 10) || 0;
            }
        }
        else {
            // Fallback: parse git status -sb
            const statusResult = await this.sshService.executeCommand(connectionId, 'git status -sb', cwd);
            if (statusResult.exitCode === 0) {
                const line = (statusResult.stdout || '').split('\n')[0] || '';
                const aheadMatch = line.match(/ahead\s+(\d+)/i);
                const behindMatch = line.match(/behind\s+(\d+)/i);
                if (aheadMatch)
                    ahead = parseInt(aheadMatch[1], 10) || 0;
                if (behindMatch)
                    behind = parseInt(behindMatch[1], 10) || 0;
            }
        }
        return { branch, defaultBranch, ahead, behind };
    }
    async listBranches(connectionId, projectPath, remote = 'origin') {
        const cwd = this.normalizeRemotePath(projectPath);
        // Check if remote exists
        let hasRemote = false;
        const remoteCheck = await this.sshService.executeCommand(connectionId, `git remote get-url ${(0, shellEscape_1.quoteShellArg)(remote)} 2>/dev/null`, cwd);
        if (remoteCheck.exitCode === 0) {
            hasRemote = true;
            // Try to fetch (non-fatal)
            await this.sshService.executeCommand(connectionId, `git fetch --prune ${(0, shellEscape_1.quoteShellArg)(remote)} 2>/dev/null`, cwd);
        }
        let branches = [];
        if (hasRemote) {
            const { stdout } = await this.sshService.executeCommand(connectionId, `git for-each-ref --format="%(refname:short)" refs/remotes/${(0, shellEscape_1.quoteShellArg)(remote)}`, cwd);
            branches = (stdout || '')
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l.length > 0 && !l.endsWith('/HEAD'))
                .map((ref) => {
                const [remoteAlias, ...rest] = ref.split('/');
                const branch = rest.join('/') || ref;
                return {
                    ref,
                    remote: remoteAlias || remote,
                    branch,
                    label: `${remoteAlias || remote}/${branch}`,
                };
            });
            // Include local-only branches
            const localResult = await this.sshService.executeCommand(connectionId, 'git for-each-ref --format="%(refname:short)" refs/heads/', cwd);
            const remoteBranchNames = new Set(branches.map((b) => b.branch));
            const localOnly = (localResult.stdout || '')
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l.length > 0 && !remoteBranchNames.has(l))
                .map((branch) => ({ ref: branch, remote: '', branch, label: branch }));
            branches = [...branches, ...localOnly];
        }
        else {
            const localResult = await this.sshService.executeCommand(connectionId, 'git for-each-ref --format="%(refname:short)" refs/heads/', cwd);
            branches = (localResult.stdout || '')
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l.length > 0)
                .map((branch) => ({ ref: branch, remote: '', branch, label: branch }));
        }
        return branches;
    }
    async renameBranch(connectionId, repoPath, oldBranch, newBranch) {
        const cwd = this.normalizeRemotePath(repoPath);
        // Check remote tracking before rename
        let remotePushed = false;
        let remoteName = 'origin';
        const configResult = await this.sshService.executeCommand(connectionId, `git config --get branch.${(0, shellEscape_1.quoteShellArg)(oldBranch)}.remote 2>/dev/null`, cwd);
        if (configResult.exitCode === 0 && configResult.stdout.trim()) {
            remoteName = configResult.stdout.trim();
            remotePushed = true;
        }
        else {
            const lsResult = await this.sshService.executeCommand(connectionId, `git ls-remote --heads origin ${(0, shellEscape_1.quoteShellArg)(oldBranch)} 2>/dev/null`, cwd);
            if (lsResult.exitCode === 0 && lsResult.stdout.trim()) {
                remotePushed = true;
            }
        }
        // Rename local branch
        const renameResult = await this.sshService.executeCommand(connectionId, `git branch -m ${(0, shellEscape_1.quoteShellArg)(oldBranch)} ${(0, shellEscape_1.quoteShellArg)(newBranch)}`, cwd);
        if (renameResult.exitCode !== 0) {
            throw new Error(`Failed to rename branch: ${renameResult.stderr}`);
        }
        // Update remote if needed
        if (remotePushed) {
            // Delete old remote branch (non-fatal)
            await this.sshService.executeCommand(connectionId, `git push ${(0, shellEscape_1.quoteShellArg)(remoteName)} --delete ${(0, shellEscape_1.quoteShellArg)(oldBranch)} 2>/dev/null`, cwd);
            // Push new branch
            const pushResult = await this.sshService.executeCommand(connectionId, `git push -u ${(0, shellEscape_1.quoteShellArg)(remoteName)} ${(0, shellEscape_1.quoteShellArg)(newBranch)}`, cwd);
            if (pushResult.exitCode !== 0) {
                throw new Error(`Failed to push renamed branch: ${pushResult.stderr}`);
            }
        }
        return { remotePushed };
    }
    // ---------------------------------------------------------------------------
    // GitHub CLI operations (run gh commands over SSH)
    // ---------------------------------------------------------------------------
    async execGh(connectionId, worktreePath, ghArgs) {
        const cwd = this.normalizeRemotePath(worktreePath);
        return this.sshService.executeCommand(connectionId, `gh ${ghArgs}`, cwd);
    }
    async execGit(connectionId, worktreePath, gitArgs) {
        const cwd = this.normalizeRemotePath(worktreePath);
        return this.sshService.executeCommand(connectionId, `git ${gitArgs}`, cwd);
    }
}
exports.RemoteGitService = RemoteGitService;
RemoteGitService.FORCE_LOAD_DIFF_CONTENT_BYTES = 5 * 1024 * 1024;
RemoteGitService.FORCE_LOAD_DIFF_OUTPUT_BYTES = 30 * 1024 * 1024;
