"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteGitService = void 0;
const shellEscape_1 = require("../utils/shellEscape");
const diffParser_1 = require("../utils/diffParser");
class RemoteGitService {
    constructor(sshService) {
        this.sshService = sshService;
    }
    normalizeRemotePath(p) {
        // Remote paths should use forward slashes.
        return p.replace(/\\/g, '/').replace(/\/+$/g, '');
    }
    async getStatus(connectionId, worktreePath) {
        const result = await this.sshService.executeCommand(connectionId, 'git status --porcelain -b', worktreePath);
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
        const lines = (result.stdout || '')
            .trim()
            .split('\n')
            .filter((l) => l.length > 0);
        for (const line of lines) {
            const status = line.substring(0, 2);
            const file = line.substring(3);
            if (status.includes('A') || status.includes('M') || status.includes('D')) {
                stagedFiles.push(file);
            }
            if (status[1] === 'M' || status[1] === 'D') {
                unstagedFiles.push(file);
            }
            if (status.includes('??')) {
                untrackedFiles.push(file);
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
        // Get porcelain status
        const statusResult = await this.sshService.executeCommand(connectionId, 'git status --porcelain --untracked-files=all', cwd);
        if (statusResult.exitCode !== 0) {
            throw new Error(`Git status failed: ${statusResult.stderr}`);
        }
        const statusOutput = statusResult.stdout;
        if (!statusOutput.trim())
            return [];
        const statusLines = statusOutput
            .split('\n')
            .map((l) => l.replace(/\r$/, ''))
            .filter((l) => l.length > 0);
        // Batch-fetch numstat for staged and unstaged changes (one SSH call each, not per-file)
        const [stagedNumstat, unstagedNumstat] = await Promise.all([
            this.sshService.executeCommand(connectionId, 'git diff --numstat --cached', cwd),
            this.sshService.executeCommand(connectionId, 'git diff --numstat', cwd),
        ]);
        const parseNumstat = (stdout) => {
            const map = new Map();
            for (const line of stdout.split('\n').filter((l) => l.trim())) {
                const parts = line.split('\t');
                if (parts.length >= 3) {
                    const add = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
                    const del = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
                    map.set(parts[2], { add, del });
                }
            }
            return map;
        };
        const stagedStats = parseNumstat(stagedNumstat.stdout || '');
        const unstagedStats = parseNumstat(unstagedNumstat.stdout || '');
        // Collect untracked file paths so we can batch their line counts
        const untrackedPaths = [];
        const changes = [];
        for (const line of statusLines) {
            const statusCode = line.substring(0, 2);
            let filePath = line.substring(3);
            if (statusCode.includes('R') && filePath.includes('->')) {
                const parts = filePath.split('->');
                filePath = parts[parts.length - 1].trim();
            }
            let status = 'modified';
            if (statusCode.includes('A') || statusCode.includes('?'))
                status = 'added';
            else if (statusCode.includes('D'))
                status = 'deleted';
            else if (statusCode.includes('R'))
                status = 'renamed';
            else if (statusCode.includes('M'))
                status = 'modified';
            const isStaged = statusCode[0] !== ' ' && statusCode[0] !== '?';
            const staged = stagedStats.get(filePath);
            const unstaged = unstagedStats.get(filePath);
            const additions = (staged?.add ?? 0) + (unstaged?.add ?? 0);
            const deletions = (staged?.del ?? 0) + (unstaged?.del ?? 0);
            if (additions === 0 && deletions === 0 && statusCode.includes('?')) {
                untrackedPaths.push(filePath);
            }
            changes.push({ path: filePath, status, additions, deletions, isStaged });
        }
        // Batch line-count for untracked files (skip files > 512KB)
        if (untrackedPaths.length > 0) {
            const escaped = untrackedPaths.map((f) => (0, shellEscape_1.quoteShellArg)(f)).join(' ');
            // For each file: if <= 512KB, count newlines; otherwise print -1
            const script = `for f in ${escaped}; do ` +
                `s=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null); ` +
                `if [ "$s" -le ${diffParser_1.MAX_DIFF_CONTENT_BYTES} ] 2>/dev/null; then ` +
                `wc -l < "$f" 2>/dev/null || echo -1; ` +
                `else echo -1; fi; done`;
            const countResult = await this.sshService.executeCommand(connectionId, script, cwd);
            if (countResult.exitCode === 0) {
                const counts = countResult.stdout
                    .split('\n')
                    .map((l) => l.trim())
                    .filter((l) => l.length > 0);
                for (let i = 0; i < untrackedPaths.length && i < counts.length; i++) {
                    const count = parseInt(counts[i], 10);
                    if (count >= 0) {
                        const change = changes.find((c) => c.path === untrackedPaths[i]);
                        if (change)
                            change.additions = count;
                    }
                }
            }
        }
        return changes;
    }
    /**
     * Per-file diff matching the shape returned by local GitService.getFileDiff().
     * Uses a diff-first pattern: run git diff, check for binary, then fetch content only if non-binary.
     */
    async getFileDiff(connectionId, worktreePath, filePath) {
        const cwd = this.normalizeRemotePath(worktreePath);
        // Step 1: Run git diff
        const diffResult = await this.sshService.executeCommand(connectionId, `git diff --no-color --unified=2000 HEAD -- ${(0, shellEscape_1.quoteShellArg)(filePath)}`, cwd);
        // Step 2: Parse and check binary
        let diffLines = [];
        if (diffResult.exitCode === 0 && diffResult.stdout.trim()) {
            const { lines, isBinary } = (0, diffParser_1.parseDiffLines)(diffResult.stdout);
            if (isBinary) {
                return { lines: [], isBinary: true };
            }
            diffLines = lines;
        }
        // Step 3: Fetch content ONCE (non-binary only, covers both diff-success and fallback paths)
        const [showResult, catResult] = await Promise.all([
            this.sshService.executeCommand(connectionId, `s=$(git cat-file -s HEAD:${(0, shellEscape_1.quoteShellArg)(filePath)} 2>/dev/null); ` +
                `if [ "$s" -le ${diffParser_1.MAX_DIFF_CONTENT_BYTES} ] 2>/dev/null; then git show HEAD:${(0, shellEscape_1.quoteShellArg)(filePath)}; ` +
                `else echo "__EMDASH_TOO_LARGE__"; fi`, cwd),
            this.sshService.executeCommand(connectionId, `s=$(stat -c%s ${(0, shellEscape_1.quoteShellArg)(filePath)} 2>/dev/null || stat -f%z ${(0, shellEscape_1.quoteShellArg)(filePath)} 2>/dev/null); ` +
                `if [ "$s" -le ${diffParser_1.MAX_DIFF_CONTENT_BYTES} ] 2>/dev/null; then cat ${(0, shellEscape_1.quoteShellArg)(filePath)}; else echo "__EMDASH_TOO_LARGE__"; fi`, cwd),
        ]);
        const rawOriginal = showResult.exitCode === 0 ? (0, diffParser_1.stripTrailingNewline)(showResult.stdout) : undefined;
        const originalContent = rawOriginal === '__EMDASH_TOO_LARGE__' ? undefined : rawOriginal;
        const rawModified = catResult.exitCode === 0 ? (0, diffParser_1.stripTrailingNewline)(catResult.stdout) : undefined;
        const modifiedContent = rawModified === '__EMDASH_TOO_LARGE__' ? undefined : rawModified;
        // Step 4: Return based on what we have
        if (diffLines.length > 0)
            return { lines: diffLines, originalContent, modifiedContent };
        // Fallback: empty diff or diff failed — determine untracked/deleted from content
        if (modifiedContent !== undefined) {
            return {
                lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' })),
                modifiedContent,
            };
        }
        if (originalContent !== undefined) {
            return {
                lines: originalContent.split('\n').map((l) => ({ left: l, type: 'del' })),
                originalContent,
            };
        }
        return { lines: [] };
    }
    async stageFile(connectionId, worktreePath, filePath) {
        const cwd = this.normalizeRemotePath(worktreePath);
        const result = await this.sshService.executeCommand(connectionId, `git add -- ${(0, shellEscape_1.quoteShellArg)(filePath)}`, cwd);
        if (result.exitCode !== 0) {
            throw new Error(`Failed to stage file: ${result.stderr}`);
        }
    }
    async stageAllFiles(connectionId, worktreePath) {
        const cwd = this.normalizeRemotePath(worktreePath);
        const result = await this.sshService.executeCommand(connectionId, 'git add -A', cwd);
        if (result.exitCode !== 0) {
            throw new Error(`Failed to stage all files: ${result.stderr}`);
        }
    }
    async unstageFile(connectionId, worktreePath, filePath) {
        const cwd = this.normalizeRemotePath(worktreePath);
        const result = await this.sshService.executeCommand(connectionId, `git reset HEAD -- ${(0, shellEscape_1.quoteShellArg)(filePath)}`, cwd);
        if (result.exitCode !== 0) {
            throw new Error(`Failed to unstage file: ${result.stderr}`);
        }
    }
    async revertFile(connectionId, worktreePath, filePath) {
        const cwd = this.normalizeRemotePath(worktreePath);
        // Check if file exists in HEAD
        const catFileResult = await this.sshService.executeCommand(connectionId, `git cat-file -e HEAD:${(0, shellEscape_1.quoteShellArg)(filePath)}`, cwd);
        if (catFileResult.exitCode !== 0) {
            // File doesn't exist in HEAD — it's untracked. Delete it.
            await this.sshService.executeCommand(connectionId, `rm -f -- ${(0, shellEscape_1.quoteShellArg)(filePath)}`, cwd);
            return { action: 'reverted' };
        }
        // File exists in HEAD — revert it
        const checkoutResult = await this.sshService.executeCommand(connectionId, `git checkout HEAD -- ${(0, shellEscape_1.quoteShellArg)(filePath)}`, cwd);
        if (checkoutResult.exitCode !== 0) {
            throw new Error(`Failed to revert file: ${checkoutResult.stderr}`);
        }
        return { action: 'reverted' };
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
        const revListResult = await this.sshService.executeCommand(connectionId, `git rev-list --left-right --count origin/${(0, shellEscape_1.quoteShellArg)(defaultBranch)}...HEAD 2>/dev/null`, cwd);
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
