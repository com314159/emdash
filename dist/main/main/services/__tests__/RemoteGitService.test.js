"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const RemoteGitService_1 = require("../RemoteGitService");
const SshService_1 = require("../ssh/SshService");
// Mock SshService
const mockExecuteCommand = vitest_1.vi.fn();
const mockConnect = vitest_1.vi.fn();
const mockDisconnect = vitest_1.vi.fn();
vitest_1.vi.mock('../ssh/SshService', () => ({
    SshService: vitest_1.vi.fn().mockImplementation(() => ({
        executeCommand: mockExecuteCommand,
        connect: mockConnect,
        disconnect: mockDisconnect,
    })),
}));
(0, vitest_1.describe)('RemoteGitService', () => {
    let service;
    let mockSshService;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mockSshService = new SshService_1.SshService();
        service = new RemoteGitService_1.RemoteGitService(mockSshService);
    });
    (0, vitest_1.describe)('getStatus', () => {
        (0, vitest_1.it)('should parse clean repository status', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '## main...origin/main\n',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.getStatus('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result.branch).toBe('main');
            (0, vitest_1.expect)(result.isClean).toBe(true);
            (0, vitest_1.expect)(result.files).toHaveLength(0);
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', 'git status --porcelain -b', '/home/user/project');
        });
        (0, vitest_1.it)('should parse repository with uncommitted changes', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '## feature-branch\n M modified.ts\n?? untracked.txt\nA  staged.js',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.getStatus('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result.branch).toBe('feature-branch');
            (0, vitest_1.expect)(result.isClean).toBe(false);
            (0, vitest_1.expect)(result.files).toHaveLength(3);
            (0, vitest_1.expect)(result.files).toContainEqual({ status: 'M', path: 'modified.ts' });
            (0, vitest_1.expect)(result.files).toContainEqual({ status: '??', path: 'untracked.txt' });
            (0, vitest_1.expect)(result.files).toContainEqual({ status: 'A', path: 'staged.js' });
        });
        (0, vitest_1.it)('should handle ahead/behind status', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '## main...origin/main [ahead 2, behind 1]\n',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.getStatus('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result.branch).toBe('main');
        });
        (0, vitest_1.it)('should handle detached HEAD', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '## HEAD (no branch)\n M file.txt',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.getStatus('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result.branch).toBe('HEAD (no branch)');
        });
        (0, vitest_1.it)('should throw error when git status fails', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: 'fatal: not a git repository',
                exitCode: 128,
            });
            await (0, vitest_1.expect)(service.getStatus('conn-1', '/home/user/project')).rejects.toThrow('Git status failed: fatal: not a git repository');
        });
        (0, vitest_1.it)('should handle unknown branch format', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '##\n',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.getStatus('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result.branch).toBe('unknown');
        });
    });
    (0, vitest_1.describe)('createWorktree', () => {
        (0, vitest_1.beforeEach)(() => {
            vitest_1.vi.useFakeTimers();
            vitest_1.vi.setSystemTime(new Date('2024-01-15T10:30:00Z'));
        });
        (0, vitest_1.afterEach)(() => {
            vitest_1.vi.useRealTimers();
        });
        (0, vitest_1.it)('should create worktree with default base ref', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: "Preparing worktree (new branch 'task-name-1705314600000')\n",
                stderr: '',
                exitCode: 0,
            });
            const result = await service.createWorktree('conn-1', '/home/user/project', 'task name');
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', 'mkdir -p .emdash/worktrees', '/home/user/project');
            // When no baseRef is provided, getDefaultBranch is called first (git rev-parse),
            // then git worktree add is called
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', vitest_1.expect.stringContaining('git worktree add'), '/home/user/project');
            (0, vitest_1.expect)(result.branch).toContain('task-name');
            (0, vitest_1.expect)(result.isMain).toBe(false);
            (0, vitest_1.expect)(result.path).toContain('.emdash/worktrees');
        });
        (0, vitest_1.it)('should create worktree with custom base ref', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.createWorktree('conn-1', '/home/user/project', 'feature-task', 'origin/develop');
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenNthCalledWith(2, 'conn-1', vitest_1.expect.stringContaining('origin/develop'), '/home/user/project');
        });
        (0, vitest_1.it)('should sanitize task name for branch', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.createWorktree('conn-1', '/home/user/project', 'task with spaces & symbols!@#');
            (0, vitest_1.expect)(result.branch).toMatch(/^task-with-spaces-/);
            (0, vitest_1.expect)(result.branch).not.toContain(' ');
            (0, vitest_1.expect)(result.branch).not.toContain('&');
            (0, vitest_1.expect)(result.branch).not.toContain('!');
            (0, vitest_1.expect)(result.branch).not.toContain('@');
            (0, vitest_1.expect)(result.branch).not.toContain('#');
        });
        (0, vitest_1.it)('should throw error when worktree creation fails', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // mkdir succeeds
                .mockResolvedValueOnce({ stdout: 'main', stderr: '', exitCode: 0 }) // getDefaultBranch (git rev-parse)
                .mockResolvedValueOnce({
                stdout: '',
                stderr: 'fatal: A branch named \"test\" already exists',
                exitCode: 128,
            }); // git worktree add fails
            await (0, vitest_1.expect)(service.createWorktree('conn-1', '/home/user/project', 'test')).rejects.toThrow('Failed to create worktree: fatal: A branch named');
        });
        (0, vitest_1.it)('should construct correct worktree path', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.createWorktree('conn-1', '/home/user/repos/myproject', 'test-task');
            (0, vitest_1.expect)(result.path).toContain('/.emdash/worktrees/');
            (0, vitest_1.expect)(result.path).toContain('test-task');
        });
    });
    (0, vitest_1.describe)('removeWorktree', () => {
        (0, vitest_1.it)('should remove worktree successfully', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: '',
                exitCode: 0,
            });
            await service.removeWorktree('conn-1', '/home/user/project', '/home/user/project/.emdash/worktrees/test-123');
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', "git worktree remove '/home/user/project/.emdash/worktrees/test-123' --force", '/home/user/project');
        });
        (0, vitest_1.it)('should throw error when removal fails', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: 'fatal: not a valid worktree',
                exitCode: 128,
            });
            await (0, vitest_1.expect)(service.removeWorktree('conn-1', '/home/user/project', '/invalid/path')).rejects.toThrow('Failed to remove worktree: fatal: not a valid worktree');
        });
        (0, vitest_1.it)('should handle paths with spaces', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: '',
                exitCode: 0,
            });
            await service.removeWorktree('conn-1', '/home/user/my project', '/home/user/my project/.emdash/worktrees/test');
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', "git worktree remove '/home/user/my project/.emdash/worktrees/test' --force", '/home/user/my project');
        });
    });
    (0, vitest_1.describe)('getBranchList', () => {
        (0, vitest_1.it)('should return list of branches', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: 'main\ndevelop\nfeature/new-thing\n* current-branch\n  remotes/origin/main\n',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.getBranchList('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result).toHaveLength(5);
            (0, vitest_1.expect)(result).toContain('main');
            (0, vitest_1.expect)(result).toContain('develop');
            (0, vitest_1.expect)(result).toContain('feature/new-thing');
            (0, vitest_1.expect)(result).toContain('* current-branch');
            (0, vitest_1.expect)(result).toContain('  remotes/origin/main');
        });
        (0, vitest_1.it)('should return empty array when git command fails', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: 'fatal: not a git repository',
                exitCode: 128,
            });
            const result = await service.getBranchList('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result).toEqual([]);
        });
        (0, vitest_1.it)('should filter out empty lines', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: 'main\n\ndevelop\n\n',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.getBranchList('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result).toHaveLength(2);
            (0, vitest_1.expect)(result).toContain('main');
            (0, vitest_1.expect)(result).toContain('develop');
        });
    });
    (0, vitest_1.describe)('commit', () => {
        (0, vitest_1.it)('should commit with message', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '[main abc1234] Test commit\n 1 file changed, 1 insertion(+)\n',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.commit('conn-1', '/home/user/project', 'Test commit');
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', "git commit -m 'Test commit'", '/home/user/project');
            (0, vitest_1.expect)(result.exitCode).toBe(0);
        });
        (0, vitest_1.it)('should stage and commit specific files', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '[main abc1234] Commit specific files\n',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.commit('conn-1', '/home/user/project', 'Commit specific files', [
                'file1.ts',
                'file2.ts',
            ]);
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', "git add 'file1.ts' 'file2.ts' && git commit -m 'Commit specific files'", '/home/user/project');
        });
        (0, vitest_1.it)('should escape quotes in commit message', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: '',
                exitCode: 0,
            });
            await service.commit('conn-1', '/home/user/project', 'Fix bug in "authentication" module');
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', 'git commit -m \'Fix bug in "authentication" module\'', '/home/user/project');
        });
        (0, vitest_1.it)('should handle multiline commit messages', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: '',
                exitCode: 0,
            });
            await service.commit('conn-1', '/home/user/project', 'First line\n\nSecond paragraph');
            // The message should be properly escaped
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', vitest_1.expect.stringContaining('git commit'), '/home/user/project');
        });
        (0, vitest_1.it)('should handle empty files array', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: '',
                exitCode: 0,
            });
            await service.commit('conn-1', '/home/user/project', 'Commit message', []);
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', "git commit -m 'Commit message'", '/home/user/project');
        });
        (0, vitest_1.it)('should handle commit failure', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: 'nothing to commit, working tree clean',
                exitCode: 1,
            });
            const result = await service.commit('conn-1', '/home/user/project', 'Empty commit');
            (0, vitest_1.expect)(result.exitCode).toBe(1);
            (0, vitest_1.expect)(result.stderr).toBe('nothing to commit, working tree clean');
        });
        (0, vitest_1.it)('should commit files with special characters in names', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: '',
                exitCode: 0,
            });
            await service.commit('conn-1', '/home/user/project', 'Special files', [
                'file with spaces.ts',
            ]);
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', vitest_1.expect.stringContaining("git add 'file with spaces.ts'"), '/home/user/project');
        });
    });
    (0, vitest_1.describe)('getStatusDetailed', () => {
        (0, vitest_1.it)('should return empty array for non-git directory', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: 'fatal: not a git repository',
                exitCode: 128,
            });
            const result = await service.getStatusDetailed('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result).toEqual([]);
        });
        (0, vitest_1.it)('should return empty array for clean repo', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({ stdout: 'true', stderr: '', exitCode: 0 }) // rev-parse
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // status
            const result = await service.getStatusDetailed('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result).toEqual([]);
        });
        (0, vitest_1.it)('throws when porcelain v2 and v1 both fail', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({ stdout: 'true', stderr: '', exitCode: 0 }) // rev-parse
                .mockResolvedValueOnce({
                stdout: '',
                stderr: 'unsupported option',
                exitCode: 2,
            }) // status v2
                .mockResolvedValueOnce({
                stdout: '',
                stderr: 'fatal: not a git repository',
                exitCode: 128,
            }); // status v1
            await (0, vitest_1.expect)(service.getStatusDetailed('conn-1', '/home/user/project')).rejects.toThrow('fatal: not a git repository');
        });
        (0, vitest_1.it)('should parse status with additions/deletions from numstat', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({ stdout: 'true', stderr: '', exitCode: 0 }) // rev-parse
                .mockResolvedValueOnce({
                stdout: ' M src/app.ts\nA  src/new.ts\n?? untracked.txt\n',
                stderr: '',
                exitCode: 0,
            }) // status
                .mockResolvedValueOnce({
                stdout: '5\t2\tsrc/new.ts\n',
                stderr: '',
                exitCode: 0,
            }) // numstat --cached
                .mockResolvedValueOnce({
                stdout: '10\t3\tsrc/app.ts\n',
                stderr: '',
                exitCode: 0,
            }); // numstat (unstaged)
            const result = await service.getStatusDetailed('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result).toHaveLength(3);
            const appTs = result.find((c) => c.path === 'src/app.ts');
            (0, vitest_1.expect)(appTs).toBeDefined();
            (0, vitest_1.expect)(appTs.status).toBe('modified');
            (0, vitest_1.expect)(appTs.additions).toBe(10);
            (0, vitest_1.expect)(appTs.deletions).toBe(3);
            (0, vitest_1.expect)(appTs.isStaged).toBe(false);
            const newTs = result.find((c) => c.path === 'src/new.ts');
            (0, vitest_1.expect)(newTs).toBeDefined();
            (0, vitest_1.expect)(newTs.status).toBe('added');
            (0, vitest_1.expect)(newTs.isStaged).toBe(true);
            (0, vitest_1.expect)(newTs.additions).toBe(5);
            (0, vitest_1.expect)(newTs.deletions).toBe(2);
            const untracked = result.find((c) => c.path === 'untracked.txt');
            (0, vitest_1.expect)(untracked).toBeDefined();
            (0, vitest_1.expect)(untracked.status).toBe('added');
            (0, vitest_1.expect)(untracked.isStaged).toBe(false);
        });
        (0, vitest_1.it)('should batch line-count for untracked files', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({ stdout: 'true', stderr: '', exitCode: 0 }) // rev-parse
                .mockResolvedValueOnce({
                stdout: '?? file1.txt\n?? file2.txt\n',
                stderr: '',
                exitCode: 0,
            }) // status
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // numstat --cached
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // numstat
                .mockResolvedValueOnce({
                stdout: '42\n100\n',
                stderr: '',
                exitCode: 0,
            }); // wc -l batch
            const result = await service.getStatusDetailed('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result).toHaveLength(2);
            (0, vitest_1.expect)(result[0].additions).toBe(42);
            (0, vitest_1.expect)(result[1].additions).toBe(100);
        });
        (0, vitest_1.it)('should handle renamed files', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({ stdout: 'true', stderr: '', exitCode: 0 })
                .mockResolvedValueOnce({
                stdout: 'R  old.ts -> new.ts\n',
                stderr: '',
                exitCode: 0,
            })
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
            const result = await service.getStatusDetailed('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result).toHaveLength(1);
            (0, vitest_1.expect)(result[0].path).toBe('new.ts');
            (0, vitest_1.expect)(result[0].status).toBe('renamed');
            (0, vitest_1.expect)(result[0].isStaged).toBe(true);
        });
        (0, vitest_1.it)('preserves unknown numstat values as null', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({ stdout: 'true', stderr: '', exitCode: 0 })
                .mockResolvedValueOnce({
                stdout: ' M binary.png\n',
                stderr: '',
                exitCode: 0,
            })
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
                .mockResolvedValueOnce({
                stdout: '-\t-\tbinary.png\n',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.getStatusDetailed('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result).toHaveLength(1);
            (0, vitest_1.expect)(result[0].path).toBe('binary.png');
            (0, vitest_1.expect)(result[0].additions).toBeNull();
            (0, vitest_1.expect)(result[0].deletions).toBeNull();
        });
    });
    (0, vitest_1.describe)('getFileDiff', () => {
        (0, vitest_1.it)('should parse unified diff output', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({
                stdout: '__EMDASH_CONTENT__\nhello\nold line\nworld\n',
                stderr: '',
                exitCode: 0,
            }) // HEAD:file
                .mockResolvedValueOnce({
                stdout: '__EMDASH_CONTENT__\nhello\nnew line\nworld\n',
                stderr: '',
                exitCode: 0,
            }) // working file
                .mockResolvedValueOnce({
                stdout: 'diff --git a/file.ts b/file.ts\nindex abc..def 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@\n hello\n-old line\n+new line\n world\n',
                stderr: '',
                exitCode: 0,
            }); // git diff
            const result = await service.getFileDiff('conn-1', '/home/user/project', 'file.ts');
            (0, vitest_1.expect)(result.mode).toBe('text');
            (0, vitest_1.expect)(result.lines).toHaveLength(4);
            (0, vitest_1.expect)(result.lines[0]).toEqual({ left: 'hello', right: 'hello', type: 'context' });
            (0, vitest_1.expect)(result.lines[1]).toEqual({ left: 'old line', type: 'del' });
            (0, vitest_1.expect)(result.lines[2]).toEqual({ right: 'new line', type: 'add' });
            (0, vitest_1.expect)(result.lines[3]).toEqual({ left: 'world', right: 'world', type: 'context' });
            (0, vitest_1.expect)(result.originalContent).toBe('hello\nold line\nworld');
            (0, vitest_1.expect)(result.modifiedContent).toBe('hello\nnew line\nworld');
        });
        (0, vitest_1.it)('should handle untracked file (no diff, read content)', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({
                stdout: '__EMDASH_MISSING__\n',
                stderr: '',
                exitCode: 0,
            }) // HEAD:file missing
                .mockResolvedValueOnce({
                stdout: '__EMDASH_CONTENT__\nline1\nline2\nline3\n',
                stderr: '',
                exitCode: 0,
            }) // working file
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // git diff
            const result = await service.getFileDiff('conn-1', '/home/user/project', 'newfile.txt');
            (0, vitest_1.expect)(result.mode).toBe('text');
            (0, vitest_1.expect)(result.lines).toHaveLength(3);
            (0, vitest_1.expect)(result.lines[0]).toEqual({ right: 'line1', type: 'add' });
            (0, vitest_1.expect)(result.lines[1]).toEqual({ right: 'line2', type: 'add' });
            (0, vitest_1.expect)(result.lines[2]).toEqual({ right: 'line3', type: 'add' });
            (0, vitest_1.expect)(result.originalContent).toBeUndefined();
            (0, vitest_1.expect)(result.modifiedContent).toBe('line1\nline2\nline3');
        });
        (0, vitest_1.it)('classifies untracked files with NUL bytes as binary', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({
                stdout: '__EMDASH_MISSING__\n',
                stderr: '',
                exitCode: 0,
            }) // git show HEAD:file wrapper
                .mockResolvedValueOnce({
                stdout: '__EMDASH_CONTENT__\nabc\u0000def',
                stderr: '',
                exitCode: 0,
            }); // cat file wrapper
            const result = await service.getFileDiff('conn-1', '/home/user/project', 'image.png');
            (0, vitest_1.expect)(result.mode).toBe('binary');
            (0, vitest_1.expect)(result.isBinary).toBe(true);
            (0, vitest_1.expect)(result.lines).toEqual([]);
        });
        (0, vitest_1.it)('should handle deleted file with realistic diff output', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({
                stdout: '__EMDASH_CONTENT__\nold content\nwas here\n',
                stderr: '',
                exitCode: 0,
            }) // HEAD:file
                .mockResolvedValueOnce({
                stdout: '__EMDASH_MISSING__\n',
                stderr: '',
                exitCode: 0,
            }) // working file missing
                .mockResolvedValueOnce({
                stdout: 'diff --git a/deleted.txt b/deleted.txt\ndeleted file mode 100644\nindex abc1234..0000000\n--- a/deleted.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-old content\n-was here\n',
                stderr: '',
                exitCode: 0,
            }); // git diff
            const result = await service.getFileDiff('conn-1', '/home/user/project', 'deleted.txt');
            (0, vitest_1.expect)(result.mode).toBe('text');
            (0, vitest_1.expect)(result.lines).toHaveLength(2);
            (0, vitest_1.expect)(result.lines[0]).toEqual({ left: 'old content', type: 'del' });
            (0, vitest_1.expect)(result.lines[1]).toEqual({ left: 'was here', type: 'del' });
            (0, vitest_1.expect)(result.originalContent).toBe('old content\nwas here');
            (0, vitest_1.expect)(result.modifiedContent).toBeUndefined();
        });
        (0, vitest_1.it)('should return empty lines when all fallbacks fail', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({
                stdout: '__EMDASH_MISSING__\n',
                stderr: '',
                exitCode: 0,
            }) // HEAD:file missing
                .mockResolvedValueOnce({
                stdout: '__EMDASH_MISSING__\n',
                stderr: '',
                exitCode: 0,
            }) // working file missing
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 }); // git diff fails
            const result = await service.getFileDiff('conn-1', '/home/user/project', 'ghost.txt');
            (0, vitest_1.expect)(result.mode).toBe('unrenderable');
            (0, vitest_1.expect)(result.lines).toEqual([]);
            (0, vitest_1.expect)(result.originalContent).toBeUndefined();
            (0, vitest_1.expect)(result.modifiedContent).toBeUndefined();
        });
        (0, vitest_1.it)('should handle staged new file (git show HEAD fails, diff and cat succeed)', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({
                stdout: '__EMDASH_MISSING__\n',
                stderr: '',
                exitCode: 0,
            }) // HEAD:file missing
                .mockResolvedValueOnce({
                stdout: '__EMDASH_CONTENT__\nline one\nline two\n',
                stderr: '',
                exitCode: 0,
            }) // working file
                .mockResolvedValueOnce({
                stdout: 'diff --git a/newfile.ts b/newfile.ts\nnew file mode 100644\nindex 0000000..abc1234\n--- /dev/null\n+++ b/newfile.ts\n@@ -0,0 +1,2 @@\n+line one\n+line two\n',
                stderr: '',
                exitCode: 0,
            }); // git diff
            const result = await service.getFileDiff('conn-1', '/home/user/project', 'newfile.ts');
            (0, vitest_1.expect)(result.mode).toBe('text');
            (0, vitest_1.expect)(result.lines).toHaveLength(2);
            (0, vitest_1.expect)(result.lines[0]).toEqual({ right: 'line one', type: 'add' });
            (0, vitest_1.expect)(result.lines[1]).toEqual({ right: 'line two', type: 'add' });
            (0, vitest_1.expect)(result.originalContent).toBeUndefined();
            (0, vitest_1.expect)(result.modifiedContent).toBe('line one\nline two');
        });
        (0, vitest_1.it)('should skip "No newline at end of file" markers', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({
                stdout: '__EMDASH_CONTENT__\nhello\nold line',
                stderr: '',
                exitCode: 0,
            }) // HEAD:file
                .mockResolvedValueOnce({
                stdout: '__EMDASH_CONTENT__\nhello\nnew line',
                stderr: '',
                exitCode: 0,
            }) // working file
                .mockResolvedValueOnce({
                stdout: 'diff --git a/file.ts b/file.ts\nindex abc1234..def5678 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n hello\n-old line\n\\ No newline at end of file\n+new line\n\\ No newline at end of file\n',
                stderr: '',
                exitCode: 0,
            }); // git diff
            const result = await service.getFileDiff('conn-1', '/home/user/project', 'file.ts');
            (0, vitest_1.expect)(result.mode).toBe('text');
            (0, vitest_1.expect)(result.lines).toHaveLength(3);
            (0, vitest_1.expect)(result.lines[0]).toEqual({ left: 'hello', right: 'hello', type: 'context' });
            (0, vitest_1.expect)(result.lines[1]).toEqual({ left: 'old line', type: 'del' });
            (0, vitest_1.expect)(result.lines[2]).toEqual({ right: 'new line', type: 'add' });
            (0, vitest_1.expect)(result.originalContent).toBe('hello\nold line');
            (0, vitest_1.expect)(result.modifiedContent).toBe('hello\nnew line');
        });
        (0, vitest_1.it)('should detect binary files and return empty lines with isBinary flag', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({
                stdout: '__EMDASH_MISSING__\n',
                stderr: '',
                exitCode: 0,
            }) // HEAD:file
                .mockResolvedValueOnce({
                stdout: '__EMDASH_MISSING__\n',
                stderr: '',
                exitCode: 0,
            }) // working file
                .mockResolvedValueOnce({
                stdout: 'diff --git a/image.png b/image.png\nindex abc1234..def5678 100644\nBinary files a/image.png and b/image.png differ\n',
                stderr: '',
                exitCode: 0,
            }); // git diff
            const result = await service.getFileDiff('conn-1', '/home/user/project', 'image.png');
            (0, vitest_1.expect)(result.lines).toEqual([]);
            (0, vitest_1.expect)(result.mode).toBe('binary');
            (0, vitest_1.expect)(result.isBinary).toBe(true);
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledTimes(3);
        });
        (0, vitest_1.it)('uses merge-base and HEAD object content when baseRef is provided', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({
                stdout: 'abc123\n',
                stderr: '',
                exitCode: 0,
            }) // git merge-base
                .mockResolvedValueOnce({
                stdout: '__EMDASH_CONTENT__\nold\n',
                stderr: '',
                exitCode: 0,
            }) // git show <merge-base>:file
                .mockResolvedValueOnce({
                stdout: '__EMDASH_CONTENT__\nnew\n',
                stderr: '',
                exitCode: 0,
            }) // git show HEAD:file
                .mockResolvedValueOnce({
                stdout: 'diff --git a/file.ts b/file.ts\nindex abc..def 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n',
                stderr: '',
                exitCode: 0,
            }); // git diff <merge-base> HEAD
            const result = await service.getFileDiff('conn-1', '/home/user/project', 'file.ts', 'origin/main');
            (0, vitest_1.expect)(result.mode).toBe('text');
            (0, vitest_1.expect)(result.originalContent).toBe('old');
            (0, vitest_1.expect)(result.modifiedContent).toBe('new');
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', "git merge-base 'origin/main' HEAD", '/home/user/project');
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', "git diff --no-color --unified=2000 'abc123' HEAD -- 'file.ts'", '/home/user/project');
        });
        (0, vitest_1.it)('returns empty text diff for unchanged tracked files', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({
                stdout: '__EMDASH_CONTENT__\nsame\n',
                stderr: '',
                exitCode: 0,
            }) // HEAD:file
                .mockResolvedValueOnce({
                stdout: '__EMDASH_CONTENT__\nsame\n',
                stderr: '',
                exitCode: 0,
            }) // working file
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // git diff
            const result = await service.getFileDiff('conn-1', '/home/user/project', 'file.ts');
            (0, vitest_1.expect)(result.mode).toBe('text');
            (0, vitest_1.expect)(result.lines).toEqual([]);
            (0, vitest_1.expect)(result.originalContent).toBe('same');
            (0, vitest_1.expect)(result.modifiedContent).toBe('same');
        });
    });
    (0, vitest_1.describe)('updateIndex', () => {
        (0, vitest_1.it)('should stage selected files via git add', async () => {
            mockExecuteCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
            await service.updateIndex('conn-1', '/home/user/project', {
                action: 'stage',
                scope: 'paths',
                filePaths: ['src/app.ts'],
            });
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', "git add -- 'src/app.ts'", '/home/user/project');
        });
        (0, vitest_1.it)('should throw on stage failure', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: 'fatal: pathspec not found',
                exitCode: 128,
            });
            await (0, vitest_1.expect)(service.updateIndex('conn-1', '/home/user/project', {
                action: 'stage',
                scope: 'paths',
                filePaths: ['nonexistent.ts'],
            })).rejects.toThrow('Failed to stage file');
        });
        (0, vitest_1.it)('should stage all files via git add -A', async () => {
            mockExecuteCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
            await service.updateIndex('conn-1', '/home/user/project', {
                action: 'stage',
                scope: 'all',
            });
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', 'git add -A', '/home/user/project');
        });
        (0, vitest_1.it)('should unstage selected files via git reset HEAD', async () => {
            mockExecuteCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
            await service.updateIndex('conn-1', '/home/user/project', {
                action: 'unstage',
                scope: 'paths',
                filePaths: ['src/app.ts'],
            });
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', "git reset HEAD -- 'src/app.ts'", '/home/user/project');
        });
        (0, vitest_1.it)('should escape special characters in file path', async () => {
            mockExecuteCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
            await service.updateIndex('conn-1', '/home/user/project', {
                action: 'stage',
                scope: 'paths',
                filePaths: ["file with spaces & 'quotes'.ts"],
            });
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', vitest_1.expect.stringContaining('git add --'), '/home/user/project');
        });
    });
    (0, vitest_1.describe)('revertFile', () => {
        (0, vitest_1.it)('should delete untracked file when not in HEAD', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({
                stdout: '',
                stderr: 'fatal: Not a valid object name',
                exitCode: 128,
            }) // cat-file -e fails
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // rm -f
            const result = await service.revertFile('conn-1', '/home/user/project', 'newfile.txt');
            (0, vitest_1.expect)(result.action).toBe('reverted');
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', "rm -f -- 'newfile.txt'", '/home/user/project');
        });
        (0, vitest_1.it)('should checkout from HEAD for tracked file', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // cat-file -e succeeds
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // checkout HEAD
            const result = await service.revertFile('conn-1', '/home/user/project', 'existing.ts');
            (0, vitest_1.expect)(result.action).toBe('reverted');
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', "git checkout HEAD -- 'existing.ts'", '/home/user/project');
        });
        (0, vitest_1.it)('should throw when checkout fails', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // cat-file
                .mockResolvedValueOnce({
                stdout: '',
                stderr: 'error: pathspec did not match',
                exitCode: 1,
            }); // checkout fails
            await (0, vitest_1.expect)(service.revertFile('conn-1', '/home/user/project', 'broken.ts')).rejects.toThrow('Failed to revert file');
        });
    });
    (0, vitest_1.describe)('getCurrentBranch', () => {
        (0, vitest_1.it)('should return current branch name', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: 'feature/my-branch\n',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.getCurrentBranch('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result).toBe('feature/my-branch');
        });
        (0, vitest_1.it)('should return empty string for detached HEAD', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: '\n',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.getCurrentBranch('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result).toBe('');
        });
    });
    (0, vitest_1.describe)('push', () => {
        (0, vitest_1.it)('should run git push', async () => {
            mockExecuteCommand.mockResolvedValue({
                stdout: 'Everything up-to-date',
                stderr: '',
                exitCode: 0,
            });
            const result = await service.push('conn-1', '/home/user/project');
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', 'git push', '/home/user/project');
            (0, vitest_1.expect)(result.exitCode).toBe(0);
        });
        (0, vitest_1.it)('should set upstream when requested', async () => {
            mockExecuteCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
            await service.push('conn-1', '/home/user/project', 'feature-branch', true);
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', "git push --set-upstream origin 'feature-branch'", '/home/user/project');
        });
    });
    (0, vitest_1.describe)('getBranchStatus', () => {
        (0, vitest_1.it)('should return branch status with ahead/behind', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({
                stdout: 'feature-branch\n',
                stderr: '',
                exitCode: 0,
            }) // branch --show-current
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 }) // gh fails
                .mockResolvedValueOnce({ stdout: 'main\n', stderr: '', exitCode: 0 }) // remote show origin
                .mockResolvedValueOnce({
                stdout: '3\t5\n',
                stderr: '',
                exitCode: 0,
            }); // rev-list
            const result = await service.getBranchStatus('conn-1', '/home/user/project');
            (0, vitest_1.expect)(result.branch).toBe('feature-branch');
            (0, vitest_1.expect)(result.defaultBranch).toBe('main');
            (0, vitest_1.expect)(result.behind).toBe(3);
            (0, vitest_1.expect)(result.ahead).toBe(5);
        });
    });
    (0, vitest_1.describe)('renameBranch', () => {
        (0, vitest_1.it)('should rename local branch', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 }) // no remote tracking
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 }) // ls-remote empty
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // branch -m
            const result = await service.renameBranch('conn-1', '/home/user/project', 'old-name', 'new-name');
            (0, vitest_1.expect)(result.remotePushed).toBe(false);
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', "git branch -m 'old-name' 'new-name'", '/home/user/project');
        });
        (0, vitest_1.it)('should update remote when branch was pushed', async () => {
            mockExecuteCommand
                .mockResolvedValueOnce({
                stdout: 'origin\n',
                stderr: '',
                exitCode: 0,
            }) // remote tracking
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // branch -m
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // push --delete
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // push -u
            const result = await service.renameBranch('conn-1', '/home/user/project', 'old-name', 'new-name');
            (0, vitest_1.expect)(result.remotePushed).toBe(true);
        });
    });
    (0, vitest_1.describe)('execGh and execGit', () => {
        (0, vitest_1.it)('should run gh commands with correct cwd', async () => {
            mockExecuteCommand.mockResolvedValue({ stdout: '{}', stderr: '', exitCode: 0 });
            await service.execGh('conn-1', '/home/user/project', 'pr view --json number');
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', 'gh pr view --json number', '/home/user/project');
        });
        (0, vitest_1.it)('should run git commands with correct cwd', async () => {
            mockExecuteCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
            await service.execGit('conn-1', '/home/user/project', 'status -sb');
            (0, vitest_1.expect)(mockExecuteCommand).toHaveBeenCalledWith('conn-1', 'git status -sb', '/home/user/project');
        });
    });
    (0, vitest_1.describe)('integration scenarios', () => {
        (0, vitest_1.it)('should handle full workflow: create, check status, commit, remove', async () => {
            // Create worktree
            mockExecuteCommand
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // mkdir
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // worktree add
            const worktree = await service.createWorktree('conn-1', '/home/user/project', 'feature');
            // Check status (clean)
            mockExecuteCommand.mockResolvedValue({
                stdout: `## ${worktree.branch}\n`,
                stderr: '',
                exitCode: 0,
            });
            const status = await service.getStatus('conn-1', worktree.path);
            (0, vitest_1.expect)(status.isClean).toBe(true);
            // Commit
            mockExecuteCommand.mockResolvedValue({
                stdout: `[${worktree.branch} abc1234] Initial commit\n`,
                stderr: '',
                exitCode: 0,
            });
            const commitResult = await service.commit('conn-1', worktree.path, 'Initial commit');
            (0, vitest_1.expect)(commitResult.exitCode).toBe(0);
            // Remove worktree
            mockExecuteCommand.mockResolvedValue({
                stdout: '',
                stderr: '',
                exitCode: 0,
            });
            await (0, vitest_1.expect)(service.removeWorktree('conn-1', '/home/user/project', worktree.path)).resolves.not.toThrow();
        });
    });
});
