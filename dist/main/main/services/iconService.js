"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveServiceIcon = resolveServiceIcon;
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_https_1 = __importDefault(require("node:https"));
function toSlug(name) {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
}
function bufferToDataUrl(buf, contentType) {
    const ct = contentType.toLowerCase();
    const mime = ct.startsWith('image/') ? ct : 'image/x-icon';
    return `data:${mime};base64,${buf.toString('base64')}`;
}
function readFileAsDataUrl(abs) {
    try {
        const data = node_fs_1.default.readFileSync(abs);
        const ext = node_path_1.default.extname(abs).toLowerCase();
        const mime = ext === '.svg'
            ? 'image/svg+xml'
            : ext === '.png'
                ? 'image/png'
                : ext === '.jpg' || ext === '.jpeg'
                    ? 'image/jpeg'
                    : ext === '.ico'
                        ? 'image/x-icon'
                        : 'application/octet-stream';
        return bufferToDataUrl(data, mime);
    }
    catch {
        return null;
    }
}
function getKnownDomain(service) {
    const n = service.trim().toLowerCase();
    const map = {
        postgres: 'postgresql.org',
        postgresql: 'postgresql.org',
        redis: 'redis.io',
        minio: 'min.io',
        clickhouse: 'clickhouse.com',
        nginx: 'nginx.org',
        mysql: 'mysql.com',
        mariadb: 'mariadb.org',
        mongo: 'mongodb.com',
        mongodb: 'mongodb.com',
        rabbitmq: 'rabbitmq.com',
        kafka: 'apache.org',
        zookeeper: 'apache.org',
    };
    return map[n] ?? null;
}
function allowlisted(domain) {
    const allow = new Set([
        'postgresql.org',
        'redis.io',
        'min.io',
        'clickhouse.com',
        'nginx.org',
        'mysql.com',
        'mariadb.org',
        'mongodb.com',
        'rabbitmq.com',
        'apache.org',
    ]);
    return allow.has(domain);
}
async function fetchHttps(url, maxBytes = 200000) {
    return new Promise((resolve) => {
        try {
            node_https_1.default
                .get(url, (res) => {
                const status = res.statusCode || 0;
                const loc = res.headers.location;
                if (status >= 300 && status < 400 && loc && /^https:\/\//i.test(loc)) {
                    node_https_1.default
                        .get(loc, (res2) => {
                        pipeResp(res2);
                    })
                        .on('error', () => resolve(null));
                    return;
                }
                pipeResp(res);
                function pipeResp(r) {
                    const ct = String(r.headers['content-type'] || '').toLowerCase();
                    if (!ct.startsWith('image/')) {
                        resolve(null);
                        r.resume();
                        return;
                    }
                    const chunks = [];
                    let bytes = 0;
                    r.on('data', (chunk) => {
                        bytes += chunk.length;
                        if (bytes > maxBytes) {
                            resolve(null);
                            r.destroy();
                            return;
                        }
                        chunks.push(chunk);
                    });
                    r.on('end', () => {
                        resolve({ data: Buffer.concat(chunks), contentType: ct });
                    });
                    r.on('error', () => resolve(null));
                }
            })
                .on('error', () => resolve(null));
        }
        catch {
            resolve(null);
        }
    });
}
async function resolveServiceIcon(opts) {
    const service = opts.service?.trim();
    if (!service)
        return { ok: false };
    const slug = toSlug(service);
    // 1) Task overrides
    if (opts.taskPath) {
        const p = node_path_1.default.join(opts.taskPath, '.emdash', 'service-icons');
        const candidates = ['.svg', '.png', '.jpg', '.jpeg', '.ico'].map((ext) => node_path_1.default.join(p, `${slug}${ext}`));
        for (const abs of candidates) {
            if (node_fs_1.default.existsSync(abs)) {
                const dataUrl = readFileAsDataUrl(abs);
                if (dataUrl)
                    return { ok: true, dataUrl };
            }
        }
    }
    // 2) Cache under userData
    const cacheDir = node_path_1.default.join(electron_1.app.getPath('userData'), 'icons');
    try {
        node_fs_1.default.mkdirSync(cacheDir, { recursive: true });
    }
    catch { }
    const cacheFile = node_path_1.default.join(cacheDir, `${slug}.ico`);
    if (node_fs_1.default.existsSync(cacheFile)) {
        const dataUrl = readFileAsDataUrl(cacheFile);
        if (dataUrl)
            return { ok: true, dataUrl };
    }
    // 3) Optional network fetch to allowlisted domains only
    if (opts.allowNetwork) {
        const domain = getKnownDomain(service);
        if (domain && allowlisted(domain)) {
            const ddgUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
            const directUrl = `https://${domain}/favicon.ico`;
            const fetched = (await fetchHttps(ddgUrl)) || (await fetchHttps(directUrl));
            if (fetched) {
                try {
                    node_fs_1.default.writeFileSync(cacheFile, fetched.data);
                }
                catch { }
                const dataUrl = bufferToDataUrl(fetched.data, fetched.contentType);
                return { ok: true, dataUrl };
            }
        }
    }
    return { ok: false };
}
