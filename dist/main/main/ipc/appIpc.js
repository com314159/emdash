"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAppIpc = registerAppIpc;
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const promises_1 = require("fs/promises");
const os_1 = require("os");
const path_1 = require("path");
const ProjectPrep_1 = require("../services/ProjectPrep");
const settings_1 = require("../settings");
const openInApps_1 = require("@shared/openInApps");
const DatabaseService_1 = require("../services/DatabaseService");
const childProcessEnv_1 = require("../utils/childProcessEnv");
const remoteOpenIn_1 = require("../utils/remoteOpenIn");
const UNKNOWN_VERSION = 'unknown';
let cachedAppVersion = null;
let cachedAppVersionPromise = null;
const FONT_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedInstalledFonts = null;
const execCommand = (command, opts) => {
    return new Promise((resolve, reject) => {
        (0, child_process_1.exec)(command, {
            maxBuffer: opts?.maxBuffer ?? 8 * 1024 * 1024,
            timeout: opts?.timeout ?? 30000,
            env: (0, childProcessEnv_1.buildExternalToolEnv)(),
        }, (error, stdout) => {
            if (error)
                return reject(error);
            resolve(stdout ?? '');
        });
    });
};
const execFileCommand = (file, args, opts) => {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)(file, args, {
            timeout: opts?.timeout ?? 30000,
            env: (0, childProcessEnv_1.buildExternalToolEnv)(),
        }, (error) => {
            if (error)
                return reject(error);
            resolve();
        });
    });
};
const escapeAppleScriptString = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const dedupeAndSortFonts = (fonts) => {
    const unique = Array.from(new Set(fonts.map((font) => font.trim()).filter(Boolean)));
    return unique.sort((a, b) => a.localeCompare(b));
};
const listInstalledFontsMac = async () => {
    const stdout = await execCommand('system_profiler SPFontsDataType -json', {
        maxBuffer: 24 * 1024 * 1024,
        timeout: 60000,
    });
    const parsed = JSON.parse(stdout);
    const fonts = [];
    for (const item of parsed.SPFontsDataType ?? []) {
        for (const typeface of item.typefaces ?? []) {
            if (typeface.family)
                fonts.push(typeface.family);
        }
    }
    return dedupeAndSortFonts(fonts);
};
const listInstalledFontsLinux = async () => {
    const stdout = await execCommand('fc-list : family', { timeout: 30000 });
    const fonts = stdout
        .split('\n')
        .flatMap((line) => line.split(','))
        .map((font) => font.trim())
        .filter(Boolean);
    return dedupeAndSortFonts(fonts);
};
const listInstalledFontsWindows = async () => {
    const script = "$fonts = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts';" +
        "$props = $fonts.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' };" +
        "$props | ForEach-Object { ($_.Name -replace '\\s*\\(.*\\)$','').Trim() }";
    const stdout = await execCommand(`powershell -NoProfile -Command "${script}"`, {
        timeout: 30000,
    });
    const fonts = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    return dedupeAndSortFonts(fonts);
};
const listInstalledFonts = async () => {
    switch (process.platform) {
        case 'darwin':
            return listInstalledFontsMac();
        case 'linux':
            return listInstalledFontsLinux();
        case 'win32':
            return listInstalledFontsWindows();
        default:
            return [];
    }
};
const readPackageVersion = async (packageJsonPath) => {
    try {
        const packageJson = JSON.parse(await (0, promises_1.readFile)(packageJsonPath, 'utf-8'));
        if (packageJson.name === 'emdash' && packageJson.version) {
            return packageJson.version;
        }
    }
    catch {
        // Ignore missing or malformed package.json; try the next path.
    }
    return null;
};
const resolveAppVersion = async () => {
    // In development, we need to look for package.json in the project root.
    const isDev = !electron_1.app.isPackaged || process.env.NODE_ENV === 'development';
    const possiblePaths = isDev
        ? [
            (0, path_1.join)(__dirname, '../../../../package.json'), // from dist/main/main/ipc in dev
            (0, path_1.join)(__dirname, '../../../package.json'), // alternative dev path
            (0, path_1.join)(process.cwd(), 'package.json'), // current working directory
        ]
        : [
            (0, path_1.join)(__dirname, '../../package.json'), // from dist/main/ipc in production
            (0, path_1.join)(electron_1.app.getAppPath(), 'package.json'), // production build
        ];
    for (const packageJsonPath of possiblePaths) {
        const version = await readPackageVersion(packageJsonPath);
        if (version) {
            return version;
        }
    }
    // In dev, never use app.getVersion() as it returns Electron version.
    if (isDev) {
        return UNKNOWN_VERSION;
    }
    try {
        return electron_1.app.getVersion();
    }
    catch (error) {
        void error;
        return UNKNOWN_VERSION;
    }
};
const getCachedAppVersion = () => {
    if (cachedAppVersion) {
        return Promise.resolve(cachedAppVersion);
    }
    if (!cachedAppVersionPromise) {
        cachedAppVersionPromise = resolveAppVersion().then((version) => {
            cachedAppVersion = version;
            return version;
        });
    }
    return cachedAppVersionPromise;
};
function registerAppIpc() {
    void getCachedAppVersion();
    electron_1.ipcMain.handle('app:undo', async (event) => {
        try {
            event.sender.undo();
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('app:redo', async (event) => {
        try {
            event.sender.redo();
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('app:openExternal', async (_event, url) => {
        try {
            if (!url || typeof url !== 'string')
                throw new Error('Invalid URL');
            // Security: Validate URL protocol to prevent local file access and dangerous protocols
            const ALLOWED_PROTOCOLS = ['http:', 'https:'];
            let parsedUrl;
            try {
                parsedUrl = new URL(url);
            }
            catch {
                throw new Error('Invalid URL format');
            }
            if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
                throw new Error(`Protocol "${parsedUrl.protocol}" is not allowed. Only http and https URLs are permitted.`);
            }
            await electron_1.shell.openExternal(url);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('app:clipboard-write-text', async (_event, text) => {
        try {
            if (typeof text !== 'string')
                throw new Error('Invalid clipboard text');
            electron_1.clipboard.writeText(text);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('app:paste', async (event) => {
        try {
            const webContents = event.sender;
            if (!webContents) {
                return { success: false, error: 'No webContents available' };
            }
            webContents.paste();
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('app:openIn', async (_event, args) => {
        const target = args?.path;
        const appId = args?.app;
        const isRemote = args?.isRemote || false;
        const sshConnectionId = args?.sshConnectionId;
        if (!target || typeof target !== 'string' || !appId) {
            return { success: false, error: 'Invalid arguments' };
        }
        try {
            const platform = process.platform;
            const appConfig = (0, openInApps_1.getAppById)(appId);
            if (!appConfig) {
                return { success: false, error: 'Invalid app ID' };
            }
            const platformConfig = appConfig.platforms?.[platform];
            const label = (0, openInApps_1.getResolvedLabel)(appConfig, platform);
            if (!platformConfig && !appConfig.alwaysAvailable) {
                return { success: false, error: `${label} is not available on this platform.` };
            }
            // Handle remote SSH connections for supported editors and terminals
            if (isRemote && sshConnectionId) {
                try {
                    const connection = await DatabaseService_1.databaseService.getSshConnection(sshConnectionId);
                    if (!connection) {
                        return { success: false, error: 'SSH connection not found' };
                    }
                    // Construct remote SSH URL or command based on the app
                    // Security: Escape all user-controlled values to prevent command injection
                    if (appId === 'vscode') {
                        // VS Code Remote SSH URL format:
                        // vscode://vscode-remote/ssh-remote+user%40hostname/path
                        const remoteUrl = (0, remoteOpenIn_1.buildRemoteEditorUrl)('vscode', connection.host, connection.username, target);
                        await electron_1.shell.openExternal(remoteUrl);
                        return { success: true };
                    }
                    else if (appId === 'cursor') {
                        // Cursor uses its own URL scheme for remote SSH
                        const remoteUrl = (0, remoteOpenIn_1.buildRemoteEditorUrl)('cursor', connection.host, connection.username, target);
                        await electron_1.shell.openExternal(remoteUrl);
                        return { success: true };
                    }
                    else if (appId === 'terminal' && platform === 'darwin') {
                        // macOS Terminal.app - execute SSH command
                        const sshCommand = (0, remoteOpenIn_1.buildRemoteSshCommand)({
                            host: connection.host,
                            username: connection.username,
                            port: connection.port,
                            targetPath: target,
                        });
                        const escapedCommand = escapeAppleScriptString(sshCommand);
                        await execFileCommand('osascript', [
                            '-e',
                            `tell application "Terminal" to do script "${escapedCommand}"`,
                            '-e',
                            'tell application "Terminal" to activate',
                        ]);
                        return { success: true };
                    }
                    else if (appId === 'iterm2' && platform === 'darwin') {
                        // iTerm2 - execute SSH command
                        const sshCommand = (0, remoteOpenIn_1.buildRemoteSshCommand)({
                            host: connection.host,
                            username: connection.username,
                            port: connection.port,
                            targetPath: target,
                        });
                        const escapedCommand = escapeAppleScriptString(sshCommand);
                        await execFileCommand('osascript', [
                            '-e',
                            `tell application "iTerm" to create window with default profile command "${escapedCommand}"`,
                            '-e',
                            'tell application "iTerm" to activate',
                        ]);
                        return { success: true };
                    }
                    else if (appId === 'warp' && platform === 'darwin') {
                        // Warp URI scheme does not support a `cmd` parameter.
                        // Instead, write a temporary Launch Configuration YAML and
                        // trigger it via the warp://launch/<name> deep link.
                        const sshCommand = (0, remoteOpenIn_1.buildRemoteSshCommand)({
                            host: connection.host,
                            username: connection.username,
                            port: connection.port,
                            targetPath: target,
                        });
                        const configId = `emdash-ssh-${Date.now()}`;
                        const configDir = (0, path_1.join)((0, os_1.homedir)(), '.warp', 'launch_configurations');
                        const configPath = (0, path_1.join)(configDir, `${configId}.yaml`);
                        // Escape for YAML double-quoted string
                        const yamlCmd = sshCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                        const yaml = [
                            '---',
                            `name: ${configId}`,
                            'windows:',
                            '  - tabs:',
                            `      - title: "SSH - ${connection.host}"`,
                            '        layout:',
                            '          cwd: ""',
                            '          commands:',
                            `            - exec: "${yamlCmd}"`,
                        ].join('\n');
                        await (0, promises_1.mkdir)(configDir, { recursive: true });
                        await (0, promises_1.writeFile)(configPath, yaml, 'utf-8');
                        await electron_1.shell.openExternal(`warp://launch/${configId}`);
                        // Clean up temp config after Warp has read it
                        setTimeout(() => (0, promises_1.unlink)(configPath).catch(() => { }), 15000);
                        return { success: true };
                    }
                    else if (appId === 'ghostty') {
                        // Ghostty - execute SSH command directly.
                        // Prefer remote login shell behavior for normal prompt/init scripts while
                        // keeping deterministic fallbacks when SHELL is missing or invalid.
                        // Compatibility note: many remote hosts don't ship xterm-ghostty terminfo.
                        // The argv builder falls back to TERM=xterm-256color only when current TERM
                        // isn't supported, keeping TUIs (e.g. ranger) working without always downgrading.
                        const ghosttyExecArgs = (0, remoteOpenIn_1.buildGhosttyRemoteExecArgs)({
                            host: connection.host,
                            username: connection.username,
                            port: connection.port,
                            targetPath: target,
                        });
                        const attempts = platform === 'darwin'
                            ? [
                                {
                                    file: 'open',
                                    args: [
                                        '-n',
                                        '-b',
                                        'com.mitchellh.ghostty',
                                        '--args',
                                        '-e',
                                        ...ghosttyExecArgs,
                                    ],
                                },
                                {
                                    file: 'open',
                                    args: ['-na', 'Ghostty', '--args', '-e', ...ghosttyExecArgs],
                                },
                                { file: 'ghostty', args: ['-e', ...ghosttyExecArgs] },
                            ]
                            : [{ file: 'ghostty', args: ['-e', ...ghosttyExecArgs] }];
                        let lastError = null;
                        for (const attempt of attempts) {
                            try {
                                await execFileCommand(attempt.file, attempt.args);
                                return { success: true };
                            }
                            catch (error) {
                                lastError = error;
                            }
                        }
                        if (lastError instanceof Error)
                            throw lastError;
                        throw new Error('Unable to launch Ghostty');
                    }
                    else if (appConfig.supportsRemote) {
                        // App claims to support remote but we don't have a handler
                        return {
                            success: false,
                            error: `Remote SSH not yet implemented for ${label}`,
                        };
                    }
                }
                catch (error) {
                    return {
                        success: false,
                        error: `Failed to open remote connection: ${error instanceof Error ? error.message : String(error)}`,
                    };
                }
            }
            const quoted = (p) => `'${p.replace(/'/g, "'\\''")}'`;
            // Handle URL-based apps (like Warp)
            if (platformConfig?.openUrls) {
                for (const urlTemplate of platformConfig.openUrls) {
                    const url = urlTemplate
                        .replace('{{path_url}}', encodeURIComponent(target))
                        .replace('{{path}}', target);
                    try {
                        await electron_1.shell.openExternal(url);
                        return { success: true };
                    }
                    catch (error) {
                        void error;
                    }
                }
                return {
                    success: false,
                    error: `${label} is not installed or its URI scheme is not registered on this platform.`,
                };
            }
            // Handle command-based apps
            const commands = platformConfig?.openCommands || [];
            let command = '';
            if (commands.length > 0) {
                command = commands
                    .map((cmd) => {
                    // Chain both replacements: first {{path}}, then {{path_raw}}
                    return cmd.replace('{{path}}', quoted(target)).replace('{{path_raw}}', target);
                })
                    .join(' || ');
            }
            if (!command) {
                return { success: false, error: 'Unsupported platform or app' };
            }
            if (appConfig.autoInstall) {
                try {
                    const settings = (0, settings_1.getAppSettings)();
                    if (settings?.projectPrep?.autoInstallOnOpenInEditor) {
                        void (0, ProjectPrep_1.ensureProjectPrepared)(target).catch(() => { });
                    }
                }
                catch { }
            }
            await new Promise((resolve, reject) => {
                (0, child_process_1.exec)(command, { cwd: target, env: (0, childProcessEnv_1.buildExternalToolEnv)() }, (err) => {
                    if (err)
                        return reject(err);
                    resolve();
                });
            });
            return { success: true };
        }
        catch (error) {
            const appConfig = (0, openInApps_1.getAppById)(appId);
            const catchLabel = appConfig
                ? (0, openInApps_1.getResolvedLabel)(appConfig, process.platform)
                : appId;
            return { success: false, error: `Unable to open in ${catchLabel}` };
        }
    });
    electron_1.ipcMain.handle('app:checkInstalledApps', async () => {
        const platform = process.platform;
        const availability = {};
        // Helper to check if a command exists
        const checkCommand = (cmd) => {
            return new Promise((resolve) => {
                (0, child_process_1.exec)(`command -v ${cmd} >/dev/null 2>&1`, { env: (0, childProcessEnv_1.buildExternalToolEnv)() }, (error) => {
                    resolve(!error);
                });
            });
        };
        // Helper to check if macOS app exists by bundle ID
        const checkMacApp = (bundleId) => {
            return new Promise((resolve) => {
                (0, child_process_1.exec)(`mdfind "kMDItemCFBundleIdentifier == '${bundleId}'"`, { env: (0, childProcessEnv_1.buildExternalToolEnv)() }, (error, stdout) => {
                    resolve(!error && stdout.trim().length > 0);
                });
            });
        };
        // Helper to check if macOS app exists by name
        const checkMacAppByName = (appName) => {
            return new Promise((resolve) => {
                (0, child_process_1.exec)(`osascript -e 'id of application "${appName}"' 2>/dev/null`, { env: (0, childProcessEnv_1.buildExternalToolEnv)() }, (error) => {
                    resolve(!error);
                });
            });
        };
        for (const app of openInApps_1.OPEN_IN_APPS) {
            // Skip apps that don't have platform-specific config
            const platformConfig = app.platforms[platform];
            if (!platformConfig && !app.alwaysAvailable) {
                availability[app.id] = false;
                continue;
            }
            // Always available apps are set to true by default
            if (app.alwaysAvailable) {
                availability[app.id] = true;
                continue;
            }
            try {
                let isAvailable = false;
                // Check via bundle IDs (macOS)
                if (platformConfig?.bundleIds) {
                    for (const bundleId of platformConfig.bundleIds) {
                        if (await checkMacApp(bundleId)) {
                            isAvailable = true;
                            break;
                        }
                    }
                }
                // Check via app names (macOS)
                if (!isAvailable && platformConfig?.appNames) {
                    for (const appName of platformConfig.appNames) {
                        if (await checkMacAppByName(appName)) {
                            isAvailable = true;
                            break;
                        }
                    }
                }
                // Check via CLI commands (all platforms)
                if (!isAvailable && platformConfig?.checkCommands) {
                    for (const cmd of platformConfig.checkCommands) {
                        if (await checkCommand(cmd)) {
                            isAvailable = true;
                            break;
                        }
                    }
                }
                availability[app.id] = isAvailable;
            }
            catch (error) {
                console.error(`Error checking installed app ${app.id}:`, error);
                availability[app.id] = false;
            }
        }
        return availability;
    });
    electron_1.ipcMain.handle('app:listInstalledFonts', async (_event, args) => {
        const refresh = Boolean(args?.refresh);
        const now = Date.now();
        if (!refresh &&
            cachedInstalledFonts &&
            now - cachedInstalledFonts.fetchedAt < FONT_CACHE_TTL_MS) {
            return { success: true, fonts: cachedInstalledFonts.fonts, cached: true };
        }
        try {
            const fonts = await listInstalledFonts();
            cachedInstalledFonts = { fonts, fetchedAt: now };
            return { success: true, fonts, cached: false };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                fonts: cachedInstalledFonts?.fonts ?? [],
                cached: Boolean(cachedInstalledFonts),
            };
        }
    });
    // App metadata
    electron_1.ipcMain.handle('app:getAppVersion', () => getCachedAppVersion());
    electron_1.ipcMain.handle('app:getElectronVersion', () => process.versions.electron);
    electron_1.ipcMain.handle('app:getPlatform', () => process.platform);
}
