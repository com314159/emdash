"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Runtime entry that installs path aliases for compiled JS before loading the app.
// This avoids '@shared/*' resolution failures in the compiled Electron main process.
const node_path_1 = __importDefault(require("node:path"));
// Ensure app name is set BEFORE any module reads app.getPath('userData').
// In dev builds, if userData is resolved before app name is set, Electron defaults to
// ~/Library/Application Support/Electron which leads to confusing "missing DB/migrations" behavior.
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    app.setName('Emdash');
}
catch { }
// Install minimal path alias resolver without external deps.
// Maps:
//   @shared/* -> dist/main/shared/*
//   @/*      -> dist/main/main/*
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Module = require('module');
    const base = node_path_1.default.join(__dirname, '..'); // dist/main
    const sharedBase = node_path_1.default.join(base, 'shared');
    const mainBase = node_path_1.default.join(base, 'main');
    const orig = Module._resolveFilename;
    Module._resolveFilename = function (request, parent, isMain, options) {
        if (typeof request === 'string') {
            if (request.startsWith('@shared/')) {
                const mapped = node_path_1.default.join(sharedBase, request.slice('@shared/'.length));
                return orig.call(this, mapped, parent, isMain, options);
            }
            if (request.startsWith('@/')) {
                const mapped = node_path_1.default.join(mainBase, request.slice('@/'.length));
                return orig.call(this, mapped, parent, isMain, options);
            }
        }
        return orig.call(this, request, parent, isMain, options);
    };
}
catch { }
// Load the actual application bootstrap
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('./main');
