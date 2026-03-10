"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureRendererServer = ensureRendererServer;
const http_1 = require("http");
const fs_1 = require("fs");
const path_1 = require("path");
let serverUrl = null;
let serverStarted = false;
const DEFAULT_RENDERER_PORT = 12112;
const RENDERER_PORT_RANGE = 100;
const MIME_MAP = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.cjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};
function getMime(filePath) {
    return MIME_MAP[(0, path_1.extname)(filePath).toLowerCase()] ?? 'application/octet-stream';
}
function isPathInside(parent, child) {
    const parentPath = (0, path_1.normalize)(parent + path_1.sep);
    const childPath = (0, path_1.normalize)(child);
    return childPath.startsWith(parentPath);
}
function getRendererPortCandidates() {
    const raw = process.env.EMDASH_RENDERER_PORT;
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    const start = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RENDERER_PORT;
    return Array.from({ length: RENDERER_PORT_RANGE }, (_, i) => start + i);
}
async function listenWithFallback(server) {
    const candidates = getRendererPortCandidates();
    for (const port of candidates) {
        try {
            const addr = await new Promise((resolve, reject) => {
                let onError;
                let onListening;
                const cleanup = () => {
                    server.removeListener('error', onError);
                    server.removeListener('listening', onListening);
                };
                onError = (error) => {
                    cleanup();
                    reject(error);
                };
                onListening = () => {
                    cleanup();
                    resolve(server.address());
                };
                server.once('error', onError);
                server.once('listening', onListening);
                server.listen(port, '127.0.0.1');
            });
            if (!addr || typeof addr.port !== 'number') {
                throw new Error('Failed to start renderer server');
            }
            return addr;
        }
        catch (error) {
            const code = error?.code;
            if (code === 'EADDRINUSE') {
                if (server.listening) {
                    await new Promise((resolve) => server.close(() => resolve()));
                }
                continue;
            }
            throw error;
        }
    }
    // As a last resort, pick an ephemeral port (should be extremely rare).
    const addr = await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server.address()));
    });
    if (!addr || typeof addr.port !== 'number') {
        throw new Error('Failed to start renderer server');
    }
    return addr;
}
async function ensureRendererServer(root) {
    if (serverStarted && serverUrl)
        return serverUrl;
    const server = (0, http_1.createServer)(async (req, res) => {
        try {
            if (!req.url) {
                res.writeHead(400);
                res.end();
                return;
            }
            const url = new URL(req.url, 'http://localhost');
            const isHead = req.method === 'HEAD';
            const rawPath = decodeURIComponent(url.pathname || '/');
            const safePath = (0, path_1.normalize)(rawPath).replace(/^(\.\.[/\\])+/, '');
            let filePath = (0, path_1.join)(root, safePath);
            // Block path traversal
            if (!isPathInside(root, filePath)) {
                res.writeHead(403);
                res.end();
                return;
            }
            let stat;
            try {
                stat = await fs_1.promises.stat(filePath);
            }
            catch {
                stat = null;
            }
            if (!stat || stat.isDirectory()) {
                filePath = (0, path_1.join)(root, 'index.html');
            }
            const data = await fs_1.promises.readFile(filePath);
            res.writeHead(200, {
                'Content-Type': getMime(filePath),
                'Cache-Control': 'no-cache, no-store, must-revalidate',
            });
            if (!isHead)
                res.write(data);
            res.end();
        }
        catch {
            res.writeHead(500);
            res.end();
        }
    });
    const addr = await listenWithFallback(server);
    serverUrl = `http://127.0.0.1:${addr.port}/index.html`;
    serverStarted = true;
    return serverUrl;
}
