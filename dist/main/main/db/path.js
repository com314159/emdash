"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseFilenames = void 0;
exports.resolveDatabasePath = resolveDatabasePath;
exports.resolveMigrationsPath = resolveMigrationsPath;
const fs_1 = require("fs");
const path_1 = require("path");
const electron_1 = require("electron");
const CURRENT_DB_FILENAME = 'emdash.db';
const LEGACY_DB_FILENAMES = ['database.sqlite', 'orcbench.db'];
function resolveDatabasePath(options = {}) {
    const explicitDbFile = process.env.EMDASH_DB_FILE?.trim();
    if (explicitDbFile) {
        return (0, path_1.resolve)(explicitDbFile);
    }
    const userDataPath = options.userDataPath ?? electron_1.app.getPath('userData');
    const currentPath = (0, path_1.join)(userDataPath, CURRENT_DB_FILENAME);
    if ((0, fs_1.existsSync)(currentPath)) {
        return currentPath;
    }
    // Dev safety: prior versions sometimes resolved userData under the default Electron app
    // (e.g. ~/Library/Application Support/Electron).
    try {
        const userDataParent = (0, path_1.dirname)(userDataPath);
        const legacyDirs = ['Electron', 'emdash', 'Emdash'];
        for (const dirName of legacyDirs) {
            const candidateDir = (0, path_1.join)(userDataParent, dirName);
            const candidateCurrent = (0, path_1.join)(candidateDir, CURRENT_DB_FILENAME);
            if ((0, fs_1.existsSync)(candidateCurrent)) {
                try {
                    (0, fs_1.renameSync)(candidateCurrent, currentPath);
                    return currentPath;
                }
                catch {
                    return candidateCurrent;
                }
            }
        }
    }
    catch {
        // best-effort only
    }
    for (const legacyName of LEGACY_DB_FILENAMES) {
        const legacyPath = (0, path_1.join)(userDataPath, legacyName);
        if ((0, fs_1.existsSync)(legacyPath)) {
            try {
                (0, fs_1.renameSync)(legacyPath, currentPath);
                return currentPath;
            }
            catch {
                return legacyPath;
            }
        }
    }
    return currentPath;
}
exports.databaseFilenames = {
    current: CURRENT_DB_FILENAME,
    legacy: [...LEGACY_DB_FILENAMES],
};
function resolveMigrationsPath() {
    const { realpathSync } = require('fs');
    const appPath = electron_1.app.getAppPath();
    const resourcesPath = process.resourcesPath ?? appPath;
    // Resolve symlinks to get actual paths (handles Homebrew, symlinks, etc.)
    const resolveRealPath = (p) => {
        try {
            return realpathSync(p);
        }
        catch {
            return null;
        }
    };
    // Get the executable directory (handles more cases)
    const exePath = electron_1.app.getPath('exe');
    const exeDir = (0, path_1.dirname)(exePath);
    const candidates = [
        // Standard Electron paths
        (0, path_1.join)(appPath, 'drizzle'),
        (0, path_1.join)(appPath, '..', 'drizzle'),
        (0, path_1.join)(resourcesPath, 'drizzle'),
        // Handle ASAR unpacked
        (0, path_1.join)(resourcesPath, 'app.asar.unpacked', 'drizzle'),
        // Handle Homebrew and other symlinked installations
        ...(resolveRealPath(appPath)
            ? [
                (0, path_1.join)(resolveRealPath(appPath), 'drizzle'),
                (0, path_1.join)(resolveRealPath(appPath), '..', 'drizzle'),
            ]
            : []),
        // Handle macOS app bundle structure
        (0, path_1.join)(exeDir, '..', 'Resources', 'drizzle'),
        (0, path_1.join)(exeDir, '..', 'Resources', 'app', 'drizzle'),
        (0, path_1.join)(exeDir, '..', 'Resources', 'app.asar.unpacked', 'drizzle'),
        // Development paths
        (0, path_1.join)(process.cwd(), 'drizzle'),
        (0, path_1.join)(__dirname, '..', '..', '..', 'drizzle'),
        // Handle translocated apps on macOS
        ...(process.platform === 'darwin' && appPath.includes('AppTranslocation')
            ? [(0, path_1.join)(appPath.split('AppTranslocation')[0], 'drizzle')]
            : []),
    ];
    // Remove duplicates and try each candidate
    const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
    for (const candidate of uniqueCandidates) {
        if ((0, fs_1.existsSync)(candidate)) {
            // Verify it's actually a directory with migration files
            try {
                const files = require('fs').readdirSync(candidate);
                if (files.some((f) => f.endsWith('.sql'))) {
                    console.log(`Found migrations at: ${candidate}`);
                    return candidate;
                }
            }
            catch {
                // Not a valid directory, continue
            }
        }
    }
    // Log diagnostic information to help debug
    console.error('Failed to find drizzle migrations folder. Searched paths:');
    console.error('- appPath:', appPath);
    console.error('- resourcesPath:', resourcesPath);
    console.error('- exeDir:', exeDir);
    console.error('- cwd:', process.cwd());
    console.error('- __dirname:', __dirname);
    console.error('- Candidates checked:', uniqueCandidates);
    return null;
}
