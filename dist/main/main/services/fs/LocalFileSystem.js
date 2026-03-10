"use strict";
/**
 * Local FileSystem implementation
 * Wraps Node.js fs operations for local disk access with security and performance features
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalFileSystem = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const readline_1 = require("readline");
const types_1 = require("./types");
const gitIgnore_1 = require("../../utils/gitIgnore");
// Binary file extensions to skip during search
const BINARY_EXTENSIONS = new Set([
    '.exe',
    '.dll',
    '.so',
    '.dylib',
    '.bin',
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.bmp',
    '.ico',
    '.svg',
    '.mp3',
    '.mp4',
    '.avi',
    '.mov',
    '.wmv',
    '.flv',
    '.webm',
    '.zip',
    '.tar',
    '.gz',
    '.bz2',
    '.7z',
    '.rar',
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    '.eot',
    '.wasm',
    '.class',
    '.jar',
    '.pyc',
    '.o',
    '.a',
]);
// Directories to skip during search
const SEARCH_IGNORES = new Set([
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    'dist',
    'build',
    '.next',
    '.nuxt',
    'coverage',
    '.cache',
    '.parcel-cache',
]);
// Allowed image extensions for readImage
const ALLOWED_IMAGE_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.svg',
    '.bmp',
    '.ico',
]);
// MIME types for images
const IMAGE_MIME_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
};
class LocalFileSystem {
    constructor(projectPath) {
        this.projectPath = projectPath;
        if (!projectPath) {
            throw new types_1.FileSystemError('Project path is required', types_1.FileSystemErrorCodes.INVALID_PATH);
        }
        this.projectPath = (0, path_1.resolve)(projectPath);
    }
    /**
     * Resolve and validate a relative path, ensuring it doesn't escape the project root
     */
    resolvePath(relPath) {
        // Normalize the path and resolve it against project root
        const normalizedRelPath = relPath.replace(/\\/g, '/').replace(/^\//, '');
        const fullPath = (0, path_1.resolve)((0, path_1.join)(this.projectPath, normalizedRelPath));
        // Security: ensure path is within projectPath (handle trailing separator edge cases)
        const projectPathWithSep = this.projectPath.endsWith(path_1.sep)
            ? this.projectPath
            : this.projectPath + path_1.sep;
        const fullPathWithSep = fullPath.endsWith(path_1.sep) ? fullPath : fullPath + path_1.sep;
        if (!fullPathWithSep.startsWith(projectPathWithSep) && fullPath !== this.projectPath) {
            throw new types_1.FileSystemError(`Path traversal detected: ${relPath}`, types_1.FileSystemErrorCodes.PATH_ESCAPE, relPath);
        }
        return fullPath;
    }
    /**
     * Get relative path from absolute path
     */
    relPath(fullPath) {
        return (0, path_1.relative)(this.projectPath, fullPath);
    }
    /**
     * Check if a path should be ignored during search
     */
    shouldIgnore(name) {
        return SEARCH_IGNORES.has(name);
    }
    /**
     * Check if file is binary by extension
     */
    isBinaryFile(filePath) {
        const ext = (0, path_1.extname)(filePath).toLowerCase();
        return BINARY_EXTENSIONS.has(ext);
    }
    /**
     * Convert fs.Stats to FileEntry
     */
    statToEntry(fullPath, stat) {
        const relPath = this.relPath(fullPath);
        return {
            path: relPath,
            type: stat.isDirectory() ? 'dir' : 'file',
            size: stat.size,
            mtime: stat.mtime,
            ctime: stat.ctime,
            mode: stat.mode,
        };
    }
    async list(path = '', options = {}) {
        const startTime = Date.now();
        const fullPath = this.resolvePath(path);
        const entries = [];
        const maxEntries = options.maxEntries || 10000;
        const timeBudgetMs = options.timeBudgetMs || 30000;
        let truncated = false;
        let truncateReason;
        const listDir = async (dirPath, recursive) => {
            // Check time budget
            if (Date.now() - startTime > timeBudgetMs) {
                truncated = true;
                truncateReason = 'timeBudget';
                return;
            }
            // Check entry limit
            if (entries.length >= maxEntries) {
                truncated = true;
                truncateReason = 'maxEntries';
                return;
            }
            let items;
            try {
                items = await fs_1.promises.readdir(dirPath, { withFileTypes: true });
            }
            catch (err) {
                // Skip directories we can't read
                return;
            }
            for (const item of items) {
                // Check time budget periodically
                if (entries.length % 100 === 0 && Date.now() - startTime > timeBudgetMs) {
                    truncated = true;
                    truncateReason = 'timeBudget';
                    return;
                }
                // Skip hidden files if not included
                if (!options.includeHidden && item.name.startsWith('.')) {
                    continue;
                }
                // Skip ignored directories
                if (this.shouldIgnore(item.name)) {
                    continue;
                }
                const itemPath = (0, path_1.join)(dirPath, item.name);
                try {
                    const stat = await fs_1.promises.stat(itemPath);
                    const entry = {
                        path: this.relPath(itemPath),
                        type: item.isDirectory() ? 'dir' : 'file',
                        size: stat.size,
                        mtime: stat.mtime,
                        ctime: stat.ctime,
                        mode: stat.mode,
                    };
                    // Apply filter if specified
                    if (options.filter) {
                        const filterRegex = new RegExp(options.filter);
                        if (!filterRegex.test(item.name)) {
                            continue;
                        }
                    }
                    entries.push(entry);
                    // Check entry limit
                    if (entries.length >= maxEntries) {
                        truncated = true;
                        truncateReason = 'maxEntries';
                        return;
                    }
                    // Recurse into subdirectories
                    if (recursive && item.isDirectory()) {
                        await listDir(itemPath, true);
                    }
                }
                catch {
                    // Skip entries we can't stat
                }
            }
        };
        await listDir(fullPath, options.recursive || false);
        return {
            entries,
            total: entries.length,
            truncated,
            truncateReason,
            durationMs: Date.now() - startTime,
        };
    }
    async read(path, maxBytes = 200 * 1024) {
        const fullPath = this.resolvePath(path);
        let stat;
        try {
            stat = await fs_1.promises.stat(fullPath);
        }
        catch (err) {
            throw new types_1.FileSystemError(`File not found: ${path}`, types_1.FileSystemErrorCodes.NOT_FOUND, path);
        }
        if (stat.isDirectory()) {
            throw new types_1.FileSystemError(`Path is a directory: ${path}`, types_1.FileSystemErrorCodes.IS_DIRECTORY, path);
        }
        // Handle large files with truncation
        if (stat.size > maxBytes) {
            const fd = await fs_1.promises.open(fullPath, 'r');
            try {
                const buffer = Buffer.alloc(maxBytes);
                await fd.read(buffer, 0, maxBytes, 0);
                return {
                    content: buffer.toString('utf-8'),
                    truncated: true,
                    totalSize: stat.size,
                };
            }
            finally {
                await fd.close();
            }
        }
        const content = await fs_1.promises.readFile(fullPath, 'utf-8');
        return {
            content,
            truncated: false,
            totalSize: stat.size,
        };
    }
    async write(path, content) {
        const fullPath = this.resolvePath(path);
        // Ensure directory exists
        const dir = (0, path_1.dirname)(fullPath);
        try {
            await fs_1.promises.mkdir(dir, { recursive: true });
        }
        catch (err) {
            throw new types_1.FileSystemError(`Failed to create directory: ${dir}`, types_1.FileSystemErrorCodes.PERMISSION_DENIED, path);
        }
        try {
            await fs_1.promises.writeFile(fullPath, content, 'utf-8');
        }
        catch (err) {
            throw new types_1.FileSystemError(`Failed to write file: ${path}`, types_1.FileSystemErrorCodes.PERMISSION_DENIED, path);
        }
        const stat = await fs_1.promises.stat(fullPath);
        return {
            success: true,
            bytesWritten: stat.size,
        };
    }
    async exists(path) {
        try {
            await fs_1.promises.access(this.resolvePath(path));
            return true;
        }
        catch {
            return false;
        }
    }
    async stat(path) {
        try {
            const fullPath = this.resolvePath(path);
            const stat = await fs_1.promises.stat(fullPath);
            return this.statToEntry(fullPath, stat);
        }
        catch {
            return null;
        }
    }
    async search(query, options = {}) {
        const pattern = options.pattern || query;
        const startTime = Date.now();
        const matches = [];
        const maxResults = options.maxResults || 10000;
        const fileExtensions = options.fileExtensions;
        const caseSensitive = options.caseSensitive ?? false;
        let filesSearched = 0;
        let truncated = false;
        const searchRegex = caseSensitive
            ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        let gitIgnore;
        try {
            const gitIgnorePath = (0, path_1.join)(this.projectPath, '.gitignore');
            const content = await fs_1.promises.readFile(gitIgnorePath, 'utf-8');
            gitIgnore = new gitIgnore_1.GitIgnoreParser(content);
        }
        catch {
            // Ignore error reading .gitignore
        }
        const searchDir = async (dirPath) => {
            let items;
            try {
                items = await fs_1.promises.readdir(dirPath, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const item of items) {
                if (matches.length >= maxResults) {
                    truncated = true;
                    return;
                }
                const itemPath = (0, path_1.join)(dirPath, item.name);
                if (item.isDirectory()) {
                    const relPath = this.relPath(itemPath);
                    if (gitIgnore && gitIgnore.ignores(relPath)) {
                        continue;
                    }
                    if (!this.shouldIgnore(item.name) && !item.name.startsWith('.')) {
                        await searchDir(itemPath);
                    }
                }
                else if (item.isFile()) {
                    // Skip binary files
                    if (this.isBinaryFile(itemPath)) {
                        continue;
                    }
                    // Check file extension filter
                    if (fileExtensions && fileExtensions.length > 0) {
                        const ext = (0, path_1.extname)(item.name).toLowerCase();
                        if (!fileExtensions.some((e) => ext === e.toLowerCase() || ext === `.${e.toLowerCase()}`)) {
                            continue;
                        }
                    }
                    // Check file pattern if specified
                    if (options.filePattern) {
                        const filePatternRegex = new RegExp(options.filePattern.replace(/\*/g, '.*'));
                        if (!filePatternRegex.test(item.name)) {
                            continue;
                        }
                    }
                    filesSearched++;
                    try {
                        const fileStream = (0, fs_1.createReadStream)(itemPath, { encoding: 'utf-8' });
                        const rl = (0, readline_1.createInterface)({
                            input: fileStream,
                            crlfDelay: Infinity,
                        });
                        let lineNum = 0;
                        for await (const line of rl) {
                            lineNum++;
                            // Check for null bytes (binary file indicator)
                            if (line.includes('\0')) {
                                fileStream.destroy();
                                break;
                            }
                            const matchResult = caseSensitive
                                ? line.includes(pattern)
                                : line.toLowerCase().includes(pattern.toLowerCase());
                            if (matchResult) {
                                const column = (caseSensitive
                                    ? line.indexOf(pattern)
                                    : line.toLowerCase().indexOf(pattern.toLowerCase())) + 1;
                                matches.push({
                                    filePath: this.relPath(itemPath),
                                    line: lineNum,
                                    column,
                                    content: line.trim(),
                                    preview: line.trim().substring(0, 200),
                                });
                                if (matches.length >= maxResults) {
                                    fileStream.destroy();
                                    truncated = true;
                                    return;
                                }
                            }
                        }
                    }
                    catch {
                        // Skip files that can't be read
                    }
                }
            }
        };
        await searchDir(this.projectPath);
        return {
            matches,
            total: matches.length,
            truncated,
            filesSearched,
        };
    }
    async remove(path) {
        const fullPath = this.resolvePath(path);
        let stat;
        try {
            stat = await fs_1.promises.stat(fullPath);
        }
        catch {
            return { success: false, error: `File not found: ${path}` };
        }
        if (stat.isDirectory()) {
            return { success: false, error: `Path is a directory: ${path}` };
        }
        try {
            await fs_1.promises.unlink(fullPath);
            return { success: true };
        }
        catch (err) {
            // Attempt chmod retry on permission error
            if (err.code === 'EACCES' || err.code === 'EPERM') {
                try {
                    await fs_1.promises.chmod(fullPath, 0o666);
                    await fs_1.promises.unlink(fullPath);
                    return { success: true };
                }
                catch {
                    return { success: false, error: `Permission denied: ${path}` };
                }
            }
            return { success: false, error: err.message };
        }
    }
    async readImage(path) {
        const fullPath = this.resolvePath(path);
        // Check file extension
        const ext = (0, path_1.extname)(path).toLowerCase();
        if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
            return {
                success: false,
                error: `Unsupported image format: ${ext}. Allowed: ${Array.from(ALLOWED_IMAGE_EXTENSIONS).join(', ')}`,
            };
        }
        let stat;
        try {
            stat = await fs_1.promises.stat(fullPath);
        }
        catch {
            return { success: false, error: `Image not found: ${path}` };
        }
        if (stat.isDirectory()) {
            return { success: false, error: `Path is a directory: ${path}` };
        }
        // Size limit for images (10MB)
        const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
        if (stat.size > MAX_IMAGE_SIZE) {
            return {
                success: false,
                error: `Image too large: ${stat.size} bytes (max ${MAX_IMAGE_SIZE})`,
            };
        }
        try {
            const buffer = await fs_1.promises.readFile(fullPath);
            const base64 = buffer.toString('base64');
            const mimeType = IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
            const dataUrl = `data:${mimeType};base64,${base64}`;
            return {
                success: true,
                dataUrl,
                mimeType,
                size: stat.size,
            };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
}
exports.LocalFileSystem = LocalFileSystem;
