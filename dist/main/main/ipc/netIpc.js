"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerNetIpc = registerNetIpc;
const electron_1 = require("electron");
const node_net_1 = __importDefault(require("node:net"));
function probePort(host, port, timeoutMs = 800) {
    return new Promise((resolve) => {
        let done = false;
        const socket = node_net_1.default.createConnection({ host, port });
        const timer = setTimeout(() => {
            if (done)
                return;
            done = true;
            try {
                socket.destroy();
            }
            catch { }
            resolve(false);
        }, Math.max(1, timeoutMs));
        socket.once('connect', () => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            try {
                socket.destroy();
            }
            catch { }
            resolve(true);
        });
        socket.once('error', () => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            try {
                socket.destroy();
            }
            catch { }
            resolve(false);
        });
    });
}
function registerNetIpc() {
    electron_1.ipcMain.handle('net:probePorts', async (_e, host, ports, timeoutMs) => {
        const h = (host || 'localhost').trim() || 'localhost';
        const ps = Array.isArray(ports) ? ports.map((p) => Number(p)).filter((p) => p > 0) : [];
        const t = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 800;
        if (!ps.length)
            return { reachable: [] };
        const results = await Promise.all(ps.map((p) => probePort(h, p, t)));
        const reachable = ps.filter((_, i) => !!results[i]);
        return { reachable };
    });
}
