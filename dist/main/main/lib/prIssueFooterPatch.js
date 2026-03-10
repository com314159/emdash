"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchCurrentPrBodyWithIssueFooter = patchCurrentPrBodyWithIssueFooter;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const prIssueFooter_1 = require("./prIssueFooter");
function normalizeBodyForComparison(body) {
    return body.replace(/\r\n/g, '\n').trimEnd();
}
async function patchCurrentPrBodyWithIssueFooter({ taskPath, metadata, execFile, prUrl, }) {
    const existingBody = await execFile('gh', ['pr', 'view', '--json', 'body', '-q', '.body'], {
        cwd: taskPath,
    });
    const existingBodyText = String(existingBody.stdout || '');
    const mergedBody = (0, prIssueFooter_1.injectIssueFooter)(existingBodyText, metadata);
    if (!mergedBody) {
        return false;
    }
    if (normalizeBodyForComparison(mergedBody) === normalizeBodyForComparison(existingBodyText)) {
        return false;
    }
    const bodyFile = node_path_1.default.join(node_os_1.default.tmpdir(), `gh-pr-edit-body-${Date.now()}-${Math.random().toString(36).substring(7)}.txt`);
    try {
        node_fs_1.default.writeFileSync(bodyFile, mergedBody, 'utf8');
        const editArgs = ['pr', 'edit'];
        if (prUrl) {
            editArgs.push(prUrl);
        }
        editArgs.push('--body-file', bodyFile);
        await execFile('gh', editArgs, { cwd: taskPath });
        return true;
    }
    finally {
        if (node_fs_1.default.existsSync(bodyFile)) {
            try {
                node_fs_1.default.unlinkSync(bodyFile);
            }
            catch {
                // Ignore cleanup errors; caller should not fail due to temp-file deletion.
            }
        }
    }
}
