"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SSH_IPC_CHANNELS = void 0;
/**
 * IPC channel names for SSH operations
 * Using 'as const' ensures type safety and prevents typos
 */
exports.SSH_IPC_CHANNELS = {
    TEST_CONNECTION: 'ssh:testConnection',
    SAVE_CONNECTION: 'ssh:saveConnection',
    GET_CONNECTIONS: 'ssh:getConnections',
    DELETE_CONNECTION: 'ssh:deleteConnection',
    CONNECT: 'ssh:connect',
    DISCONNECT: 'ssh:disconnect',
    EXECUTE_COMMAND: 'ssh:executeCommand',
    LIST_FILES: 'ssh:listFiles',
    READ_FILE: 'ssh:readFile',
    WRITE_FILE: 'ssh:writeFile',
    GET_STATE: 'ssh:getState',
    ON_STATE_CHANGE: 'ssh:onStateChange',
    GET_SSH_CONFIG: 'ssh:getSshConfig',
    GET_SSH_CONFIG_HOST: 'ssh:getSshConfigHost',
    CHECK_IS_GIT_REPO: 'ssh:checkIsGitRepo',
    INIT_REPO: 'ssh:initRepo',
    CLONE_REPO: 'ssh:cloneRepo',
};
