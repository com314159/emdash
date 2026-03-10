"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitIgnoreParser = void 0;
const ignore_1 = __importDefault(require("ignore"));
class GitIgnoreParser {
    constructor(content) {
        this.ig = (0, ignore_1.default)().add(content);
    }
    ignores(path) {
        // The ignore package uses relative paths.
        // If the path ends with / it might treat it as dir, but our path input from fsListWorker typically doesn't have trailing slash.
        // 'ignore' usually handles 'node_modules' correctly matching directory.
        return this.ig.ignores(path);
    }
}
exports.GitIgnoreParser = GitIgnoreParser;
