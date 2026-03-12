"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Keep preload self-contained: sandboxed preload cannot reliably require local runtime modules.
const LIFECYCLE_EVENT_CHANNEL = 'lifecycle:event';
const GIT_STATUS_CHANGED_CHANNEL = 'git:status-changed';
const gitStatusChangedListeners = new Set();
let gitStatusBridgeAttached = false;
function attachGitStatusBridgeOnce() {
    if (gitStatusBridgeAttached)
        return;
    gitStatusBridgeAttached = true;
    electron_1.ipcRenderer.on(GIT_STATUS_CHANGED_CHANNEL, (_, data) => {
        for (const listener of gitStatusChangedListeners) {
            try {
                listener(data);
            }
            catch { }
        }
    });
}
// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // Generic invoke for the typed RPC client (createRPCClient)
    invoke: (channel, ...args) => electron_1.ipcRenderer.invoke(channel, ...args),
    // App info
    getAppVersion: () => electron_1.ipcRenderer.invoke('app:getAppVersion'),
    getElectronVersion: () => electron_1.ipcRenderer.invoke('app:getElectronVersion'),
    getPlatform: () => electron_1.ipcRenderer.invoke('app:getPlatform'),
    listInstalledFonts: (args) => electron_1.ipcRenderer.invoke('app:listInstalledFonts', args),
    undo: () => electron_1.ipcRenderer.invoke('app:undo'),
    redo: () => electron_1.ipcRenderer.invoke('app:redo'),
    // Updater
    checkForUpdates: () => electron_1.ipcRenderer.invoke('update:check'),
    downloadUpdate: () => electron_1.ipcRenderer.invoke('update:download'),
    quitAndInstallUpdate: () => electron_1.ipcRenderer.invoke('update:quit-and-install'),
    openLatestDownload: () => electron_1.ipcRenderer.invoke('update:open-latest'),
    // Enhanced update methods
    getUpdateState: () => electron_1.ipcRenderer.invoke('update:get-state'),
    getUpdateSettings: () => electron_1.ipcRenderer.invoke('update:get-settings'),
    updateUpdateSettings: (settings) => electron_1.ipcRenderer.invoke('update:update-settings', settings),
    getReleaseNotes: () => electron_1.ipcRenderer.invoke('update:get-release-notes'),
    checkForUpdatesNow: () => electron_1.ipcRenderer.invoke('update:check-now'),
    onUpdateEvent: (listener) => {
        const pairs = [
            ['update:checking', 'checking'],
            ['update:available', 'available'],
            ['update:not-available', 'not-available'],
            ['update:error', 'error'],
            ['update:downloading', 'downloading'],
            ['update:download-progress', 'download-progress'],
            ['update:downloaded', 'downloaded'],
            ['update:installing', 'installing'],
        ];
        const handlers = [];
        for (const [channel, type] of pairs) {
            const wrapped = (_, payload) => listener({ type, payload });
            electron_1.ipcRenderer.on(channel, wrapped);
            handlers.push(() => electron_1.ipcRenderer.removeListener(channel, wrapped));
        }
        return () => handlers.forEach((off) => off());
    },
    // Open a path in a specific app
    openIn: (args) => electron_1.ipcRenderer.invoke('app:openIn', args),
    // Check which apps are installed
    checkInstalledApps: () => electron_1.ipcRenderer.invoke('app:checkInstalledApps'),
    // PTY management
    ptyStart: (opts) => electron_1.ipcRenderer.invoke('pty:start', opts),
    ptyInput: (args) => electron_1.ipcRenderer.send('pty:input', args),
    ptyResize: (args) => electron_1.ipcRenderer.send('pty:resize', args),
    ptyKill: (id) => electron_1.ipcRenderer.send('pty:kill', { id }),
    ptyKillTmux: (id) => electron_1.ipcRenderer.invoke('pty:killTmux', { id }),
    // Direct PTY spawn (no shell wrapper, bypasses shell config loading)
    ptyStartDirect: (opts) => electron_1.ipcRenderer.invoke('pty:startDirect', opts),
    ptyScpToRemote: (args) => electron_1.ipcRenderer.invoke('pty:scp-to-remote', args),
    onPtyData: (id, listener) => {
        const channel = `pty:data:${id}`;
        const wrapped = (_, data) => listener(data);
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    ptyGetSnapshot: (args) => electron_1.ipcRenderer.invoke('pty:snapshot:get', args),
    ptySaveSnapshot: (args) => electron_1.ipcRenderer.invoke('pty:snapshot:save', args),
    ptyClearSnapshot: (args) => electron_1.ipcRenderer.invoke('pty:snapshot:clear', args),
    ptyCleanupSessions: (args) => electron_1.ipcRenderer.invoke('pty:cleanupSessions', args),
    onPtyExit: (id, listener) => {
        const channel = `pty:exit:${id}`;
        const wrapped = (_, info) => listener(info);
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    onPtyStarted: (listener) => {
        const channel = 'pty:started';
        const wrapped = (_, data) => listener(data);
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    onPtyActivity: (listener) => {
        const channel = 'pty:activity';
        const wrapped = (_, data) => listener(data);
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    onPtyExitGlobal: (listener) => {
        const channel = 'pty:exit:global';
        const wrapped = (_, data) => listener(data);
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    onAgentEvent: (listener) => {
        const channel = 'agent:event';
        const wrapped = (_, data, meta) => listener(data, meta);
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    onNotificationFocusTask: (listener) => {
        const channel = 'notification:focus-task';
        const wrapped = (_, taskId) => listener(taskId);
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    terminalGetTheme: () => electron_1.ipcRenderer.invoke('terminal:getTheme'),
    // Menu events (main → renderer)
    onMenuOpenSettings: (listener) => {
        const channel = 'menu:open-settings';
        const wrapped = () => listener();
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    onMenuCheckForUpdates: (listener) => {
        const channel = 'menu:check-for-updates';
        const wrapped = () => listener();
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    onMenuUndo: (listener) => {
        const channel = 'menu:undo';
        const wrapped = () => listener();
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    onMenuRedo: (listener) => {
        const channel = 'menu:redo';
        const wrapped = () => listener();
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    onMenuCloseTab: (listener) => {
        const channel = 'menu:close-tab';
        const wrapped = () => listener();
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    // Worktree management
    worktreeCreate: (args) => electron_1.ipcRenderer.invoke('worktree:create', args),
    worktreeList: (args) => electron_1.ipcRenderer.invoke('worktree:list', args),
    worktreeRemove: (args) => electron_1.ipcRenderer.invoke('worktree:remove', args),
    worktreeStatus: (args) => electron_1.ipcRenderer.invoke('worktree:status', args),
    worktreeMerge: (args) => electron_1.ipcRenderer.invoke('worktree:merge', args),
    worktreeGet: (args) => electron_1.ipcRenderer.invoke('worktree:get', args),
    worktreeGetAll: () => electron_1.ipcRenderer.invoke('worktree:getAll'),
    // Worktree pool (reserve) management for instant task creation
    worktreeEnsureReserve: (args) => electron_1.ipcRenderer.invoke('worktree:ensureReserve', args),
    worktreePreflightReserve: (args) => electron_1.ipcRenderer.invoke('worktree:preflightReserve', args),
    worktreeHasReserve: (args) => electron_1.ipcRenderer.invoke('worktree:hasReserve', args),
    worktreeClaimReserve: (args) => electron_1.ipcRenderer.invoke('worktree:claimReserve', args),
    worktreeClaimReserveAndSaveTask: (args) => electron_1.ipcRenderer.invoke('worktree:claimReserveAndSaveTask', args),
    worktreeRemoveReserve: (args) => electron_1.ipcRenderer.invoke('worktree:removeReserve', args),
    // Lifecycle scripts
    lifecycleGetScript: (args) => electron_1.ipcRenderer.invoke('lifecycle:getScript', args),
    lifecycleSetup: (args) => electron_1.ipcRenderer.invoke('lifecycle:setup', args),
    lifecycleRunStart: (args) => electron_1.ipcRenderer.invoke('lifecycle:run:start', args),
    lifecycleRunStop: (args) => electron_1.ipcRenderer.invoke('lifecycle:run:stop', args),
    lifecycleTeardown: (args) => electron_1.ipcRenderer.invoke('lifecycle:teardown', args),
    lifecycleGetState: (args) => electron_1.ipcRenderer.invoke('lifecycle:getState', args),
    lifecycleGetLogs: (args) => electron_1.ipcRenderer.invoke('lifecycle:getLogs', args),
    lifecycleClearTask: (args) => electron_1.ipcRenderer.invoke('lifecycle:clearTask', args),
    onLifecycleEvent: (listener) => {
        const wrapped = (_, data) => listener(data);
        electron_1.ipcRenderer.on(LIFECYCLE_EVENT_CHANNEL, wrapped);
        return () => electron_1.ipcRenderer.removeListener(LIFECYCLE_EVENT_CHANNEL, wrapped);
    },
    // Filesystem helpers
    fsList: (root, opts) => electron_1.ipcRenderer.invoke('fs:list', { root, ...(opts || {}) }),
    fsRead: (root, relPath, maxBytes, remote) => electron_1.ipcRenderer.invoke('fs:read', { root, relPath, maxBytes, ...remote }),
    fsReadImage: (root, relPath, remote) => electron_1.ipcRenderer.invoke('fs:read-image', { root, relPath, ...remote }),
    fsSearchContent: (root, query, options, remote) => electron_1.ipcRenderer.invoke('fs:searchContent', { root, query, options, ...remote }),
    fsWriteFile: (root, relPath, content, mkdirs, remote) => electron_1.ipcRenderer.invoke('fs:write', { root, relPath, content, mkdirs, ...remote }),
    fsRemove: (root, relPath, remote) => electron_1.ipcRenderer.invoke('fs:remove', { root, relPath, ...remote }),
    fsRename: (root, oldName, newName, remote) => electron_1.ipcRenderer.invoke('fs:rename', { root, oldName, newName, ...remote }),
    fsMkdir: (root, relPath, remote) => electron_1.ipcRenderer.invoke('fs:mkdir', { root, relPath, ...remote }),
    fsRmdir: (root, relPath, remote) => electron_1.ipcRenderer.invoke('fs:rmdir', { root, relPath, ...remote }),
    getProjectConfig: (projectPath) => electron_1.ipcRenderer.invoke('fs:getProjectConfig', { projectPath }),
    saveProjectConfig: (projectPath, content) => electron_1.ipcRenderer.invoke('fs:saveProjectConfig', { projectPath, content }),
    // Attachments
    saveAttachment: (args) => electron_1.ipcRenderer.invoke('fs:save-attachment', args),
    // Project management
    openProject: () => electron_1.ipcRenderer.invoke('project:open'),
    openFile: (args) => electron_1.ipcRenderer.invoke('project:openFile', args),
    getProjectSettings: (projectId) => electron_1.ipcRenderer.invoke('projectSettings:get', { projectId }),
    updateProjectSettings: (args) => electron_1.ipcRenderer.invoke('projectSettings:update', args),
    fetchProjectBaseRef: (args) => electron_1.ipcRenderer.invoke('projectSettings:fetchBaseRef', args),
    getGitInfo: (projectPath) => electron_1.ipcRenderer.invoke('git:getInfo', projectPath),
    getGitStatus: (taskPath) => electron_1.ipcRenderer.invoke('git:get-status', taskPath),
    getDeleteRisks: (args) => electron_1.ipcRenderer.invoke('git:get-delete-risks', args),
    watchGitStatus: (taskPath) => electron_1.ipcRenderer.invoke('git:watch-status', taskPath),
    unwatchGitStatus: (taskPath, watchId) => electron_1.ipcRenderer.invoke('git:unwatch-status', taskPath, watchId),
    onGitStatusChanged: (listener) => {
        attachGitStatusBridgeOnce();
        gitStatusChangedListeners.add(listener);
        return () => {
            gitStatusChangedListeners.delete(listener);
        };
    },
    getFileDiff: (args) => electron_1.ipcRenderer.invoke('git:get-file-diff', args),
    updateIndex: (args) => electron_1.ipcRenderer.invoke('git:update-index', args),
    revertFile: (args) => electron_1.ipcRenderer.invoke('git:revert-file', args),
    gitCommit: (args) => electron_1.ipcRenderer.invoke('git:commit', args),
    gitPush: (args) => electron_1.ipcRenderer.invoke('git:push', args),
    gitPull: (args) => electron_1.ipcRenderer.invoke('git:pull', args),
    gitGetLog: (args) => electron_1.ipcRenderer.invoke('git:get-log', args),
    gitGetLatestCommit: (args) => electron_1.ipcRenderer.invoke('git:get-latest-commit', args),
    gitGetCommitFiles: (args) => electron_1.ipcRenderer.invoke('git:get-commit-files', args),
    gitGetCommitFileDiff: (args) => electron_1.ipcRenderer.invoke('git:get-commit-file-diff', args),
    gitSoftReset: (args) => electron_1.ipcRenderer.invoke('git:soft-reset', args),
    gitCommitAndPush: (args) => electron_1.ipcRenderer.invoke('git:commit-and-push', args),
    generatePrContent: (args) => electron_1.ipcRenderer.invoke('git:generate-pr-content', args),
    createPullRequest: (args) => electron_1.ipcRenderer.invoke('git:create-pr', args),
    mergeToMain: (args) => electron_1.ipcRenderer.invoke('git:merge-to-main', args),
    mergePr: (args) => electron_1.ipcRenderer.invoke('git:merge-pr', args),
    getPrStatus: (args) => electron_1.ipcRenderer.invoke('git:get-pr-status', args),
    enableAutoMerge: (args) => electron_1.ipcRenderer.invoke('git:enable-auto-merge', args),
    disableAutoMerge: (args) => electron_1.ipcRenderer.invoke('git:disable-auto-merge', args),
    getCheckRuns: (args) => electron_1.ipcRenderer.invoke('git:get-check-runs', args),
    getPrComments: (args) => electron_1.ipcRenderer.invoke('git:get-pr-comments', args),
    getBranchStatus: (args) => electron_1.ipcRenderer.invoke('git:get-branch-status', args),
    renameBranch: (args) => electron_1.ipcRenderer.invoke('git:rename-branch', args),
    listRemoteBranches: (args) => electron_1.ipcRenderer.invoke('git:list-remote-branches', args),
    openExternal: (url) => electron_1.ipcRenderer.invoke('app:openExternal', url),
    clipboardWriteText: (text) => electron_1.ipcRenderer.invoke('app:clipboard-write-text', text),
    paste: () => electron_1.ipcRenderer.invoke('app:paste'),
    // Telemetry (minimal, anonymous)
    captureTelemetry: (event, properties) => electron_1.ipcRenderer.invoke('telemetry:capture', { event, properties }),
    getTelemetryStatus: () => electron_1.ipcRenderer.invoke('telemetry:get-status'),
    setTelemetryEnabled: (enabled) => electron_1.ipcRenderer.invoke('telemetry:set-enabled', enabled),
    setOnboardingSeen: (flag) => electron_1.ipcRenderer.invoke('telemetry:set-onboarding-seen', flag),
    connectToGitHub: (projectPath) => electron_1.ipcRenderer.invoke('github:connect', projectPath),
    // GitHub integration
    githubAuth: () => electron_1.ipcRenderer.invoke('github:auth'),
    githubCancelAuth: () => electron_1.ipcRenderer.invoke('github:auth:cancel'),
    // GitHub auth event listeners
    onGithubAuthDeviceCode: (callback) => {
        const listener = (_, data) => callback(data);
        electron_1.ipcRenderer.on('github:auth:device-code', listener);
        return () => electron_1.ipcRenderer.removeListener('github:auth:device-code', listener);
    },
    onGithubAuthPolling: (callback) => {
        const listener = (_, data) => callback(data);
        electron_1.ipcRenderer.on('github:auth:polling', listener);
        return () => electron_1.ipcRenderer.removeListener('github:auth:polling', listener);
    },
    onGithubAuthSlowDown: (callback) => {
        const listener = (_, data) => callback(data);
        electron_1.ipcRenderer.on('github:auth:slow-down', listener);
        return () => electron_1.ipcRenderer.removeListener('github:auth:slow-down', listener);
    },
    onGithubAuthSuccess: (callback) => {
        const listener = (_, data) => callback(data);
        electron_1.ipcRenderer.on('github:auth:success', listener);
        return () => electron_1.ipcRenderer.removeListener('github:auth:success', listener);
    },
    onGithubAuthError: (callback) => {
        const listener = (_, data) => callback(data);
        electron_1.ipcRenderer.on('github:auth:error', listener);
        return () => electron_1.ipcRenderer.removeListener('github:auth:error', listener);
    },
    onGithubAuthCancelled: (callback) => {
        const listener = () => callback();
        electron_1.ipcRenderer.on('github:auth:cancelled', listener);
        return () => electron_1.ipcRenderer.removeListener('github:auth:cancelled', listener);
    },
    onGithubAuthUserUpdated: (callback) => {
        const listener = (_, data) => callback(data);
        electron_1.ipcRenderer.on('github:auth:user-updated', listener);
        return () => electron_1.ipcRenderer.removeListener('github:auth:user-updated', listener);
    },
    githubIsAuthenticated: () => electron_1.ipcRenderer.invoke('github:isAuthenticated'),
    githubGetStatus: () => electron_1.ipcRenderer.invoke('github:getStatus'),
    githubGetUser: () => electron_1.ipcRenderer.invoke('github:getUser'),
    githubGetRepositories: () => electron_1.ipcRenderer.invoke('github:getRepositories'),
    githubCloneRepository: (repoUrl, localPath) => electron_1.ipcRenderer.invoke('github:cloneRepository', repoUrl, localPath),
    githubGetOwners: () => electron_1.ipcRenderer.invoke('github:getOwners'),
    githubValidateRepoName: (name, owner) => electron_1.ipcRenderer.invoke('github:validateRepoName', name, owner),
    githubCreateNewProject: (params) => electron_1.ipcRenderer.invoke('github:createNewProject', params),
    githubListPullRequests: (args) => electron_1.ipcRenderer.invoke('github:listPullRequests', args),
    githubCreatePullRequestWorktree: (args) => electron_1.ipcRenderer.invoke('github:createPullRequestWorktree', args),
    githubGetPullRequestBaseDiff: (args) => electron_1.ipcRenderer.invoke('github:getPullRequestBaseDiff', args),
    githubLogout: () => electron_1.ipcRenderer.invoke('github:logout'),
    githubCheckCLIInstalled: () => electron_1.ipcRenderer.invoke('github:checkCLIInstalled'),
    githubInstallCLI: () => electron_1.ipcRenderer.invoke('github:installCLI'),
    // GitHub issues
    githubIssuesList: (projectPath, limit) => electron_1.ipcRenderer.invoke('github:issues:list', projectPath, limit),
    githubIssuesSearch: (projectPath, searchTerm, limit) => electron_1.ipcRenderer.invoke('github:issues:search', projectPath, searchTerm, limit),
    githubIssueGet: (projectPath, number) => electron_1.ipcRenderer.invoke('github:issues:get', projectPath, number),
    // Linear integration
    linearSaveToken: (token) => electron_1.ipcRenderer.invoke('linear:saveToken', token),
    linearCheckConnection: () => electron_1.ipcRenderer.invoke('linear:checkConnection'),
    linearClearToken: () => electron_1.ipcRenderer.invoke('linear:clearToken'),
    linearInitialFetch: (limit) => electron_1.ipcRenderer.invoke('linear:initialFetch', limit),
    linearSearchIssues: (searchTerm, limit) => electron_1.ipcRenderer.invoke('linear:searchIssues', searchTerm, limit),
    // Jira integration
    jiraSaveCredentials: (args) => electron_1.ipcRenderer.invoke('jira:saveCredentials', args),
    jiraClearCredentials: () => electron_1.ipcRenderer.invoke('jira:clearCredentials'),
    jiraCheckConnection: () => electron_1.ipcRenderer.invoke('jira:checkConnection'),
    jiraInitialFetch: (limit) => electron_1.ipcRenderer.invoke('jira:initialFetch', limit),
    jiraSearchIssues: (searchTerm, limit) => electron_1.ipcRenderer.invoke('jira:searchIssues', searchTerm, limit),
    // GitLab integration
    gitlabSaveCredentials: (args) => electron_1.ipcRenderer.invoke('gitlab:saveCredentials', args),
    gitlabClearCredentials: () => electron_1.ipcRenderer.invoke('gitlab:clearCredentials'),
    gitlabCheckConnection: () => electron_1.ipcRenderer.invoke('gitlab:checkConnection'),
    gitlabInitialFetch: (projectPath, limit) => electron_1.ipcRenderer.invoke('gitlab:initialFetch', { projectPath, limit }),
    gitlabSearchIssues: (projectPath, searchTerm, limit) => electron_1.ipcRenderer.invoke('gitlab:searchIssues', { projectPath, searchTerm, limit }),
    // Plain integration
    plainSaveToken: (token) => electron_1.ipcRenderer.invoke('plain:saveToken', token),
    plainCheckConnection: () => electron_1.ipcRenderer.invoke('plain:checkConnection'),
    plainClearToken: () => electron_1.ipcRenderer.invoke('plain:clearToken'),
    plainInitialFetch: (limit, statuses) => electron_1.ipcRenderer.invoke('plain:initialFetch', limit, statuses),
    plainSearchThreads: (searchTerm, limit) => electron_1.ipcRenderer.invoke('plain:searchThreads', searchTerm, limit),
    // Forgejo integration
    forgejoSaveCredentials: (args) => electron_1.ipcRenderer.invoke('forgejo:saveCredentials', args),
    forgejoClearCredentials: () => electron_1.ipcRenderer.invoke('forgejo:clearCredentials'),
    forgejoCheckConnection: () => electron_1.ipcRenderer.invoke('forgejo:checkConnection'),
    forgejoInitialFetch: (projectPath, limit) => electron_1.ipcRenderer.invoke('forgejo:initialFetch', { projectPath, limit }),
    forgejoSearchIssues: (projectPath, searchTerm, limit) => electron_1.ipcRenderer.invoke('forgejo:searchIssues', { projectPath, searchTerm, limit }),
    getProviderStatuses: (opts) => electron_1.ipcRenderer.invoke('providers:getStatuses', opts ?? {}),
    getProviderCustomConfig: (providerId) => electron_1.ipcRenderer.invoke('providers:getCustomConfig', providerId),
    getAllProviderCustomConfigs: () => electron_1.ipcRenderer.invoke('providers:getAllCustomConfigs'),
    updateProviderCustomConfig: (providerId, config) => electron_1.ipcRenderer.invoke('providers:updateCustomConfig', providerId, config),
    // Debug helpers
    debugAppendLog: (filePath, content, options) => electron_1.ipcRenderer.invoke('debug:append-log', filePath, content, options ?? {}),
    // PlanMode strict lock
    planApplyLock: (taskPath) => electron_1.ipcRenderer.invoke('plan:lock', taskPath),
    planReleaseLock: (taskPath) => electron_1.ipcRenderer.invoke('plan:unlock', taskPath),
    onPlanEvent: (listener) => {
        const channel = 'plan:event';
        const wrapped = (_, data) => listener(data);
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    onProviderStatusUpdated: (listener) => {
        const channel = 'provider:status-updated';
        const wrapped = (_, data) => listener(data);
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    // Host preview (non-container)
    hostPreviewStart: (args) => electron_1.ipcRenderer.invoke('preview:host:start', args),
    hostPreviewSetup: (args) => electron_1.ipcRenderer.invoke('preview:host:setup', args),
    hostPreviewStop: (taskId) => electron_1.ipcRenderer.invoke('preview:host:stop', taskId),
    hostPreviewStopAll: (exceptId) => electron_1.ipcRenderer.invoke('preview:host:stopAll', exceptId),
    onHostPreviewEvent: (listener) => {
        const channel = 'preview:host:event';
        const wrapped = (_, data) => listener(data);
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    // Main-managed browser (WebContentsView)
    browserShow: (bounds, url) => electron_1.ipcRenderer.invoke('browser:view:show', { ...bounds, url }),
    browserHide: () => electron_1.ipcRenderer.invoke('browser:view:hide'),
    browserSetBounds: (bounds) => electron_1.ipcRenderer.invoke('browser:view:setBounds', bounds),
    browserLoadURL: (url, forceReload) => electron_1.ipcRenderer.invoke('browser:view:loadURL', url, forceReload),
    browserGoBack: () => electron_1.ipcRenderer.invoke('browser:view:goBack'),
    browserGoForward: () => electron_1.ipcRenderer.invoke('browser:view:goForward'),
    browserReload: () => electron_1.ipcRenderer.invoke('browser:view:reload'),
    browserOpenDevTools: () => electron_1.ipcRenderer.invoke('browser:view:openDevTools'),
    browserClear: () => electron_1.ipcRenderer.invoke('browser:view:clear'),
    onBrowserViewEvent: (listener) => {
        const channel = 'browser:view:event';
        const wrapped = (_, data) => listener(data);
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    // Lightweight TCP probe for localhost ports to avoid noisy fetches
    netProbePorts: (host, ports, timeoutMs) => electron_1.ipcRenderer.invoke('net:probePorts', host, ports, timeoutMs),
    // SSH operations (unwrap { success, ... } IPC responses)
    sshTestConnection: (config) => electron_1.ipcRenderer.invoke('ssh:testConnection', config),
    sshSaveConnection: async (config) => {
        const res = await electron_1.ipcRenderer.invoke('ssh:saveConnection', config);
        if (res && typeof res === 'object' && 'success' in res && !res.success) {
            throw new Error(res.error || 'Failed to save SSH connection');
        }
        return res.connection;
    },
    sshGetConnections: async () => {
        const res = await electron_1.ipcRenderer.invoke('ssh:getConnections');
        if (res && typeof res === 'object' && 'success' in res && !res.success) {
            throw new Error(res.error || 'Failed to load SSH connections');
        }
        return res.connections || [];
    },
    sshDeleteConnection: async (id) => {
        const res = await electron_1.ipcRenderer.invoke('ssh:deleteConnection', id);
        if (res && typeof res === 'object' && 'success' in res && !res.success) {
            throw new Error(res.error || 'Failed to delete SSH connection');
        }
    },
    sshConnect: async (arg) => {
        const res = await electron_1.ipcRenderer.invoke('ssh:connect', arg);
        if (res && typeof res === 'object' && 'success' in res) {
            if (!res.success) {
                throw new Error(res.error || 'SSH connect failed');
            }
            return res.connectionId;
        }
        return res;
    },
    sshDisconnect: async (connectionId) => {
        const res = await electron_1.ipcRenderer.invoke('ssh:disconnect', connectionId);
        if (res && typeof res === 'object' && 'success' in res && !res.success) {
            throw new Error(res.error || 'SSH disconnect failed');
        }
    },
    sshExecuteCommand: async (connectionId, command, cwd) => {
        const res = await electron_1.ipcRenderer.invoke('ssh:executeCommand', connectionId, command, cwd);
        if (res && typeof res === 'object' && 'success' in res && !res.success) {
            throw new Error(res.error || 'SSH command failed');
        }
        return {
            stdout: res.stdout || '',
            stderr: res.stderr || '',
            exitCode: res.exitCode ?? -1,
        };
    },
    sshListFiles: async (connectionId, path) => {
        const res = await electron_1.ipcRenderer.invoke('ssh:listFiles', connectionId, path);
        if (res && typeof res === 'object' && 'success' in res && !res.success) {
            throw new Error(res.error || 'SSH list files failed');
        }
        return res.files || [];
    },
    sshReadFile: async (connectionId, path) => {
        const res = await electron_1.ipcRenderer.invoke('ssh:readFile', connectionId, path);
        if (res && typeof res === 'object' && 'success' in res && !res.success) {
            throw new Error(res.error || 'SSH read file failed');
        }
        return res.content || '';
    },
    sshWriteFile: async (connectionId, path, content) => {
        const res = await electron_1.ipcRenderer.invoke('ssh:writeFile', connectionId, path, content);
        if (res && typeof res === 'object' && 'success' in res && !res.success) {
            throw new Error(res.error || 'SSH write file failed');
        }
    },
    sshGetState: async (connectionId) => {
        const res = await electron_1.ipcRenderer.invoke('ssh:getState', connectionId);
        if (res && typeof res === 'object' && 'success' in res && !res.success) {
            throw new Error(res.error || 'SSH get state failed');
        }
        return res.state;
    },
    sshGetConfig: () => electron_1.ipcRenderer.invoke('ssh:getSshConfig'),
    sshGetSshConfigHost: (hostAlias) => electron_1.ipcRenderer.invoke('ssh:getSshConfigHost', hostAlias),
    sshCheckIsGitRepo: async (connectionId, remotePath) => {
        const res = await electron_1.ipcRenderer.invoke('ssh:checkIsGitRepo', connectionId, remotePath);
        if (res && typeof res === 'object' && 'success' in res && !res.success) {
            throw new Error(res.error || 'SSH check git repo failed');
        }
        return res.isGitRepo;
    },
    sshInitRepo: async (connectionId, parentPath, repoName) => {
        const res = await electron_1.ipcRenderer.invoke('ssh:initRepo', connectionId, parentPath, repoName);
        if (res && typeof res === 'object' && 'success' in res && !res.success) {
            throw new Error(res.error || 'SSH init repo failed');
        }
        return res.path;
    },
    sshCloneRepo: async (connectionId, repoUrl, targetPath) => {
        const res = await electron_1.ipcRenderer.invoke('ssh:cloneRepo', connectionId, repoUrl, targetPath);
        if (res && typeof res === 'object' && 'success' in res && !res.success) {
            throw new Error(res.error || 'SSH clone repo failed');
        }
        return res.path;
    },
    // Skills management
    skillsGetCatalog: () => electron_1.ipcRenderer.invoke('skills:getCatalog'),
    skillsRefreshCatalog: () => electron_1.ipcRenderer.invoke('skills:refreshCatalog'),
    skillsInstall: (args) => electron_1.ipcRenderer.invoke('skills:install', args),
    skillsUninstall: (args) => electron_1.ipcRenderer.invoke('skills:uninstall', args),
    skillsGetDetail: (args) => electron_1.ipcRenderer.invoke('skills:getDetail', args),
    skillsGetDetectedAgents: () => electron_1.ipcRenderer.invoke('skills:getDetectedAgents'),
    skillsCreate: (args) => electron_1.ipcRenderer.invoke('skills:create', args),
    // MCP
    mcpLoadAll: () => electron_1.ipcRenderer.invoke('mcp:load-all'),
    mcpSaveServer: (server) => electron_1.ipcRenderer.invoke('mcp:save-server', server),
    mcpRemoveServer: (serverName) => electron_1.ipcRenderer.invoke('mcp:remove-server', serverName),
    mcpGetProviders: () => electron_1.ipcRenderer.invoke('mcp:get-providers'),
    mcpRefreshProviders: () => electron_1.ipcRenderer.invoke('mcp:refresh-providers'),
});
