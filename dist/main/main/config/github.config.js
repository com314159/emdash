"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GITHUB_CONFIG = void 0;
/**
 * GitHub OAuth configuration for Device Flow authentication.
 * No client secret needed - Device Flow is designed for desktop/CLI apps.
 */
exports.GITHUB_CONFIG = {
    clientId: 'Ov23ligC35uHWopzCeWf',
    scopes: ['repo', 'read:user', 'read:org'],
};
