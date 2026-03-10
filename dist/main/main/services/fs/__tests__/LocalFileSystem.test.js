"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const LocalFileSystem_1 = require("../LocalFileSystem");
const types_1 = require("../types");
(0, vitest_1.describe)('LocalFileSystem', () => {
    let tempDir;
    let fsService;
    (0, vitest_1.beforeEach)(() => {
        tempDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'fs-test-'));
        fsService = new LocalFileSystem_1.LocalFileSystem(tempDir);
    });
    (0, vitest_1.afterEach)(() => {
        fs_1.default.rmSync(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.describe)('constructor', () => {
        (0, vitest_1.it)('should throw error when project path is empty', () => {
            (0, vitest_1.expect)(() => new LocalFileSystem_1.LocalFileSystem('')).toThrow(types_1.FileSystemError);
            (0, vitest_1.expect)(() => new LocalFileSystem_1.LocalFileSystem('')).toThrow('Project path is required');
        });
        (0, vitest_1.it)('should resolve project path', () => {
            const relativePath = 'relative/project';
            const service = new LocalFileSystem_1.LocalFileSystem(relativePath);
            (0, vitest_1.expect)(service).toBeDefined();
        });
    });
    (0, vitest_1.describe)('list', () => {
        (0, vitest_1.it)('should list files in directory', async () => {
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'file1.txt'), 'content1');
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'file2.txt'), 'content2');
            fs_1.default.mkdirSync(path_1.default.join(tempDir, 'subdir'));
            const result = await fsService.list('');
            (0, vitest_1.expect)(result.entries).toHaveLength(3);
            (0, vitest_1.expect)(result.entries.some((e) => e.path === 'file1.txt' && e.type === 'file')).toBe(true);
            (0, vitest_1.expect)(result.entries.some((e) => e.path === 'file2.txt' && e.type === 'file')).toBe(true);
            (0, vitest_1.expect)(result.entries.some((e) => e.path === 'subdir' && e.type === 'dir')).toBe(true);
        });
        (0, vitest_1.it)('should list files in subdirectory', async () => {
            const subdir = path_1.default.join(tempDir, 'subdir');
            fs_1.default.mkdirSync(subdir);
            fs_1.default.writeFileSync(path_1.default.join(subdir, 'nested.txt'), 'nested content');
            const result = await fsService.list('subdir');
            (0, vitest_1.expect)(result.entries).toHaveLength(1);
            (0, vitest_1.expect)(result.entries[0].path).toBe('subdir/nested.txt');
        });
        (0, vitest_1.it)('should list recursively', async () => {
            fs_1.default.mkdirSync(path_1.default.join(tempDir, 'level1'));
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'level1/file1.txt'), 'content1');
            fs_1.default.mkdirSync(path_1.default.join(tempDir, 'level1/level2'));
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'level1/level2/file2.txt'), 'content2');
            const result = await fsService.list('', { recursive: true });
            (0, vitest_1.expect)(result.entries.some((e) => e.path === 'level1')).toBe(true);
            (0, vitest_1.expect)(result.entries.some((e) => e.path === 'level1/file1.txt')).toBe(true);
            (0, vitest_1.expect)(result.entries.some((e) => e.path === 'level1/level2')).toBe(true);
            (0, vitest_1.expect)(result.entries.some((e) => e.path === 'level1/level2/file2.txt')).toBe(true);
        });
        (0, vitest_1.it)('should exclude hidden files by default', async () => {
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'visible.txt'), 'content');
            fs_1.default.writeFileSync(path_1.default.join(tempDir, '.hidden'), 'hidden content');
            const result = await fsService.list('');
            (0, vitest_1.expect)(result.entries.some((e) => e.path === 'visible.txt')).toBe(true);
            (0, vitest_1.expect)(result.entries.some((e) => e.path === '.hidden')).toBe(false);
        });
        (0, vitest_1.it)('should include hidden files when specified', async () => {
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'visible.txt'), 'content');
            fs_1.default.writeFileSync(path_1.default.join(tempDir, '.hidden'), 'hidden content');
            const result = await fsService.list('', { includeHidden: true });
            (0, vitest_1.expect)(result.entries.some((e) => e.path === '.hidden')).toBe(true);
        });
        (0, vitest_1.it)('should apply filter pattern', async () => {
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'test.ts'), 'typescript');
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'test.js'), 'javascript');
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'readme.md'), 'markdown');
            const result = await fsService.list('', { filter: '.*\\.ts$' });
            (0, vitest_1.expect)(result.entries).toHaveLength(1);
            (0, vitest_1.expect)(result.entries[0].path).toBe('test.ts');
        });
        (0, vitest_1.it)('should truncate when maxEntries reached', async () => {
            for (let i = 0; i < 10; i++) {
                fs_1.default.writeFileSync(path_1.default.join(tempDir, `file${i}.txt`), 'content');
            }
            const result = await fsService.list('', { maxEntries: 5 });
            (0, vitest_1.expect)(result.total).toBe(5);
            (0, vitest_1.expect)(result.truncated).toBe(true);
            (0, vitest_1.expect)(result.truncateReason).toBe('maxEntries');
        });
        (0, vitest_1.it)('should truncate when time budget exceeded', async () => {
            // Create many files to ensure time budget is exceeded
            for (let i = 0; i < 1000; i++) {
                fs_1.default.writeFileSync(path_1.default.join(tempDir, `file${i}.txt`), 'content');
            }
            const result = await fsService.list('', { recursive: true, timeBudgetMs: 1 });
            (0, vitest_1.expect)(result.truncated).toBe(true);
            (0, vitest_1.expect)(result.truncateReason).toBe('timeBudget');
        });
        (0, vitest_1.it)('should include file metadata', async () => {
            const filePath = path_1.default.join(tempDir, 'test.txt');
            fs_1.default.writeFileSync(filePath, 'test content');
            const result = await fsService.list('');
            (0, vitest_1.expect)(result.entries[0].size).toBe(12);
            (0, vitest_1.expect)(result.entries[0].mtime).toBeInstanceOf(Date);
            (0, vitest_1.expect)(result.entries[0].mode).toBeDefined();
        });
    });
    (0, vitest_1.describe)('read', () => {
        (0, vitest_1.it)('should read file content', async () => {
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'test.txt'), 'Hello, World!');
            const result = await fsService.read('test.txt');
            (0, vitest_1.expect)(result.content).toBe('Hello, World!');
            (0, vitest_1.expect)(result.truncated).toBe(false);
            (0, vitest_1.expect)(result.totalSize).toBe(13);
        });
        (0, vitest_1.it)('should throw error when file not found', async () => {
            await (0, vitest_1.expect)(fsService.read('nonexistent.txt')).rejects.toThrow(types_1.FileSystemError);
            await (0, vitest_1.expect)(fsService.read('nonexistent.txt')).rejects.toThrow('File not found');
        });
        (0, vitest_1.it)('should throw error when path is directory', async () => {
            fs_1.default.mkdirSync(path_1.default.join(tempDir, 'subdir'));
            await (0, vitest_1.expect)(fsService.read('subdir')).rejects.toThrow(types_1.FileSystemError);
            await (0, vitest_1.expect)(fsService.read('subdir')).rejects.toThrow('Path is a directory');
        });
        (0, vitest_1.it)('should truncate large files', async () => {
            const largeContent = 'x'.repeat(300 * 1024); // 300KB
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'large.txt'), largeContent);
            const result = await fsService.read('large.txt', 200 * 1024);
            (0, vitest_1.expect)(result.truncated).toBe(true);
            (0, vitest_1.expect)(result.content.length).toBe(200 * 1024);
            (0, vitest_1.expect)(result.totalSize).toBe(300 * 1024);
        });
        (0, vitest_1.it)('should not truncate files under maxBytes', async () => {
            const content = 'Small content';
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'small.txt'), content);
            const result = await fsService.read('small.txt', 200 * 1024);
            (0, vitest_1.expect)(result.truncated).toBe(false);
            (0, vitest_1.expect)(result.content).toBe(content);
        });
    });
    (0, vitest_1.describe)('write', () => {
        (0, vitest_1.it)('should write file content', async () => {
            const result = await fsService.write('newfile.txt', 'New content');
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(fs_1.default.readFileSync(path_1.default.join(tempDir, 'newfile.txt'), 'utf-8')).toBe('New content');
        });
        (0, vitest_1.it)('should create parent directories', async () => {
            const result = await fsService.write('nested/deep/file.txt', 'Deep content');
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(fs_1.default.existsSync(path_1.default.join(tempDir, 'nested/deep/file.txt'))).toBe(true);
        });
        (0, vitest_1.it)('should return bytes written', async () => {
            const content = 'Test content';
            const result = await fsService.write('test.txt', content);
            (0, vitest_1.expect)(result.bytesWritten).toBe(Buffer.byteLength(content, 'utf-8'));
        });
        (0, vitest_1.it)('should throw error when cannot create directory', async () => {
            // Make tempDir read-only (on Unix systems)
            if (process.platform !== 'win32') {
                fs_1.default.chmodSync(tempDir, 0o555);
                try {
                    await (0, vitest_1.expect)(fsService.write('readonly/test.txt', 'content')).rejects.toThrow(types_1.FileSystemError);
                }
                finally {
                    fs_1.default.chmodSync(tempDir, 0o755);
                }
            }
        });
    });
    (0, vitest_1.describe)('exists', () => {
        (0, vitest_1.it)('should return true for existing file', async () => {
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'exists.txt'), 'content');
            const result = await fsService.exists('exists.txt');
            (0, vitest_1.expect)(result).toBe(true);
        });
        (0, vitest_1.it)('should return true for existing directory', async () => {
            fs_1.default.mkdirSync(path_1.default.join(tempDir, 'subdir'));
            const result = await fsService.exists('subdir');
            (0, vitest_1.expect)(result).toBe(true);
        });
        (0, vitest_1.it)('should return false for non-existent path', async () => {
            const result = await fsService.exists('nonexistent.txt');
            (0, vitest_1.expect)(result).toBe(false);
        });
    });
    (0, vitest_1.describe)('stat', () => {
        (0, vitest_1.it)('should return file entry for file', async () => {
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'test.txt'), 'content');
            const result = await fsService.stat('test.txt');
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result?.path).toBe('test.txt');
            (0, vitest_1.expect)(result?.type).toBe('file');
            (0, vitest_1.expect)(result?.size).toBe(7);
        });
        (0, vitest_1.it)('should return file entry for directory', async () => {
            fs_1.default.mkdirSync(path_1.default.join(tempDir, 'subdir'));
            const result = await fsService.stat('subdir');
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result?.path).toBe('subdir');
            (0, vitest_1.expect)(result?.type).toBe('dir');
        });
        (0, vitest_1.it)('should return null for non-existent path', async () => {
            const result = await fsService.stat('nonexistent.txt');
            (0, vitest_1.expect)(result).toBeNull();
        });
    });
    (0, vitest_1.describe)('search', () => {
        (0, vitest_1.beforeEach)(() => {
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'file1.ts'), 'const foo = "bar";\nfunction test() {}');
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'file2.ts'), 'let x = 1;\nconst foo = 2;');
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'readme.md'), '# README\nThis is documentation');
            const subdir = path_1.default.join(tempDir, 'src');
            fs_1.default.mkdirSync(subdir);
            fs_1.default.writeFileSync(path_1.default.join(subdir, 'main.ts'), 'function main() {\n  console.log(foo);\n}');
        });
        (0, vitest_1.it)('should find matches in files', async () => {
            const result = await fsService.search('foo');
            (0, vitest_1.expect)(result.total).toBeGreaterThan(0);
            (0, vitest_1.expect)(result.matches.some((m) => m.filePath === 'file1.ts')).toBe(true);
            (0, vitest_1.expect)(result.matches.some((m) => m.filePath === 'file2.ts')).toBe(true);
            (0, vitest_1.expect)(result.matches.some((m) => m.filePath === 'src/main.ts')).toBe(true);
        });
        (0, vitest_1.it)('should return match details', async () => {
            const result = await fsService.search('foo');
            const match = result.matches.find((m) => m.filePath === 'file1.ts');
            (0, vitest_1.expect)(match).toBeDefined();
            (0, vitest_1.expect)(match?.line).toBe(1);
            (0, vitest_1.expect)(match?.column).toBeGreaterThan(0);
            (0, vitest_1.expect)(match?.content).toContain('foo');
        });
        (0, vitest_1.it)('should respect maxResults', async () => {
            const result = await fsService.search('foo', { maxResults: 2 });
            (0, vitest_1.expect)(result.total).toBe(2);
            (0, vitest_1.expect)(result.truncated).toBe(true);
        });
        (0, vitest_1.it)('should filter by file extensions', async () => {
            const result = await fsService.search('foo', { fileExtensions: ['.ts'] });
            (0, vitest_1.expect)(result.matches.every((m) => m.filePath.endsWith('.ts'))).toBe(true);
        });
        (0, vitest_1.it)('should filter by file pattern', async () => {
            const result = await fsService.search('foo', { filePattern: '*.md' });
            (0, vitest_1.expect)(result.total).toBe(0);
        });
        (0, vitest_1.it)('should be case-insensitive by default', async () => {
            const result1 = await fsService.search('FOO');
            const result2 = await fsService.search('foo');
            (0, vitest_1.expect)(result1.total).toBe(result2.total);
        });
        (0, vitest_1.it)('should respect caseSensitive option', async () => {
            const result = await fsService.search('FOO', { caseSensitive: true });
            (0, vitest_1.expect)(result.total).toBe(0);
        });
        (0, vitest_1.it)('should skip binary files', async () => {
            // Create a "binary" file with null bytes
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
            const result = await fsService.search('\x00');
            (0, vitest_1.expect)(result.matches).toHaveLength(0);
        });
        (0, vitest_1.it)('should skip ignored directories', async () => {
            const nodeModules = path_1.default.join(tempDir, 'node_modules');
            fs_1.default.mkdirSync(nodeModules);
            fs_1.default.writeFileSync(path_1.default.join(nodeModules, 'test.ts'), 'const foo = "ignored";');
            const result = await fsService.search('foo');
            (0, vitest_1.expect)(result.matches.some((m) => m.filePath.includes('node_modules'))).toBe(false);
        });
        (0, vitest_1.it)('should track files searched', async () => {
            const result = await fsService.search('foo');
            (0, vitest_1.expect)(result.filesSearched).toBeGreaterThan(0);
        });
    });
    (0, vitest_1.describe)('remove', () => {
        (0, vitest_1.it)('should remove file', async () => {
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'delete.txt'), 'content');
            const result = await fsService.remove('delete.txt');
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(fs_1.default.existsSync(path_1.default.join(tempDir, 'delete.txt'))).toBe(false);
        });
        (0, vitest_1.it)('should fail when file not found', async () => {
            const result = await fsService.remove('nonexistent.txt');
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error).toContain('File not found');
        });
        (0, vitest_1.it)('should fail when path is directory', async () => {
            fs_1.default.mkdirSync(path_1.default.join(tempDir, 'subdir'));
            const result = await fsService.remove('subdir');
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error).toContain('directory');
        });
        (0, vitest_1.it)('should retry with chmod on permission error', async () => {
            if (process.platform !== 'win32') {
                const filePath = path_1.default.join(tempDir, 'readonly.txt');
                fs_1.default.writeFileSync(filePath, 'content');
                fs_1.default.chmodSync(filePath, 0o444);
                try {
                    const result = await fsService.remove('readonly.txt');
                    (0, vitest_1.expect)(result.success).toBe(true);
                }
                finally {
                    // Restore permissions for cleanup
                    try {
                        fs_1.default.chmodSync(filePath, 0o666);
                    }
                    catch {
                        // Ignore
                    }
                }
            }
        });
    });
    (0, vitest_1.describe)('readImage', () => {
        (0, vitest_1.it)('should read image as data URL', async () => {
            // Create a minimal valid PNG file (1x1 transparent pixel)
            const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'test.png'), pngBuffer);
            const result = await fsService.readImage('test.png');
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.dataUrl).toMatch(/^data:image\/png;base64,/);
            (0, vitest_1.expect)(result.mimeType).toBe('image/png');
            (0, vitest_1.expect)(result.size).toBe(pngBuffer.length);
        });
        (0, vitest_1.it)('should reject unsupported image formats', async () => {
            // bmp is not in the allowed list
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'test.xyz'), 'fake-data');
            const result = await fsService.readImage('test.xyz');
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error).toContain('Unsupported image format');
        });
        (0, vitest_1.it)('should fail when image not found', async () => {
            const result = await fsService.readImage('nonexistent.png');
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error).toContain('not found');
        });
        (0, vitest_1.it)('should fail when path is directory', async () => {
            fs_1.default.mkdirSync(path_1.default.join(tempDir, 'images'));
            // Directories don't have extensions, so this will fail with unsupported format
            // or directory error depending on implementation order
            const result = await fsService.readImage('images');
            (0, vitest_1.expect)(result.success).toBe(false);
        });
        (0, vitest_1.it)('should reject oversized images', async () => {
            // Create a fake large "image" file
            const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'large.png'), largeBuffer);
            const result = await fsService.readImage('large.png');
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error).toContain('too large');
        });
    });
    (0, vitest_1.describe)('path traversal protection', () => {
        (0, vitest_1.it)('should block absolute path traversal', async () => {
            // Absolute paths get normalized by resolvePath
            await (0, vitest_1.expect)(fsService.read('/etc/passwd')).rejects.toThrow();
        });
        (0, vitest_1.it)('should block relative path traversal', async () => {
            await (0, vitest_1.expect)(fsService.read('../package.json')).rejects.toThrow();
        });
        (0, vitest_1.it)('should block nested path traversal', async () => {
            fs_1.default.mkdirSync(path_1.default.join(tempDir, 'subdir'));
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'subdir/file.txt'), 'content');
            await (0, vitest_1.expect)(fsService.read('subdir/../../../etc/passwd')).rejects.toThrow();
        });
        (0, vitest_1.it)('should normalize paths with double slashes', async () => {
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'test.txt'), 'content');
            const result = await fsService.read('//test.txt');
            (0, vitest_1.expect)(result.content).toBe('content');
        });
        (0, vitest_1.it)('should allow valid subpaths', async () => {
            fs_1.default.mkdirSync(path_1.default.join(tempDir, 'valid'));
            fs_1.default.mkdirSync(path_1.default.join(tempDir, 'valid/nested'));
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'valid/nested/file.txt'), 'content');
            const result = await fsService.read('valid/nested/file.txt');
            (0, vitest_1.expect)(result.content).toBe('content');
        });
    });
    (0, vitest_1.describe)('large file handling', () => {
        (0, vitest_1.it)('should handle files larger than default maxBytes', async () => {
            const largeContent = 'x'.repeat(500 * 1024); // 500KB
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'large.txt'), largeContent);
            const result = await fsService.read('large.txt');
            (0, vitest_1.expect)(result.truncated).toBe(true);
            (0, vitest_1.expect)(result.content.length).toBe(200 * 1024); // Default limit
        });
        (0, vitest_1.it)('should handle custom maxBytes limit', async () => {
            const content = 'x'.repeat(100);
            fs_1.default.writeFileSync(path_1.default.join(tempDir, 'medium.txt'), content);
            const result = await fsService.read('medium.txt', 50);
            (0, vitest_1.expect)(result.truncated).toBe(true);
            (0, vitest_1.expect)(result.content.length).toBe(50);
        });
    });
});
