"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRPCController = createRPCController;
exports.createRPCRouter = createRPCRouter;
exports.registerRPCRouter = registerRPCRouter;
exports.createRPCClient = createRPCClient;
function createRPCController(handlers) {
    return handlers;
}
function createRPCRouter(routers) {
    return routers;
}
function registerRPCRouter(router, ipcMain) {
    for (const [ns, handlers] of Object.entries(router)) {
        for (const [key, fn] of Object.entries(handlers)) {
            const channel = `${ns}.${key}`;
            ipcMain.handle(channel, (_event, ...args) => fn(...args));
        }
    }
}
function createRPCClient(invoke) {
    return new Proxy({}, {
        get(_, ns) {
            if (typeof ns !== 'string' || ns === 'then')
                return undefined;
            return new Proxy({}, {
                get(_, procedure) {
                    if (typeof procedure !== 'string' || procedure === 'then')
                        return undefined;
                    return (...args) => invoke(`${ns}.${procedure}`, ...args);
                },
            });
        },
    });
}
