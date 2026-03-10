"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoUpdateService = exports.UpdateChannel = void 0;
const electron_1 = require("electron");
const electron_updater_1 = require("electron-updater");
const logger_1 = require("../lib/logger");
const updaterError_1 = require("../lib/updaterError");
// Update check intervals (in milliseconds)
const UPDATE_CHECK_INTERVALS = {
    startup: 5 * 60 * 1000, // 5 minutes after startup
    periodic: 4 * 60 * 60 * 1000, // Every 4 hours
    manual: 0, // Immediate for manual checks
};
const INSTALL_RESTART_GUARD_TIMEOUT_MS = 2 * 60 * 1000;
// Update channels for staged rollouts
var UpdateChannel;
(function (UpdateChannel) {
    UpdateChannel["STABLE"] = "stable";
    UpdateChannel["BETA"] = "beta";
    UpdateChannel["ALPHA"] = "alpha";
    UpdateChannel["NIGHTLY"] = "nightly";
})(UpdateChannel || (exports.UpdateChannel = UpdateChannel = {}));
class AutoUpdateService {
    constructor() {
        this.initialized = false;
        this.installRequested = false;
        const appVersion = this.getAppVersion();
        this.updateState = {
            status: 'idle',
            currentVersion: appVersion,
            channel: UpdateChannel.STABLE,
        };
        this.settings = {
            autoCheck: true,
            autoDownload: false, // Always false by default - user must opt-in to download
            checkInterval: UPDATE_CHECK_INTERVALS.periodic,
            channel: UpdateChannel.STABLE,
            allowPrerelease: false,
            allowDowngrade: false,
        };
        // Don't setup autoUpdater in constructor - wait for initialize()
    }
    getAppVersion() {
        try {
            const { readFileSync } = require('fs');
            const { join } = require('path');
            // In development, look for package.json in project root
            const isDev = !electron_1.app.isPackaged || process.env.NODE_ENV === 'development';
            const possiblePaths = isDev
                ? [
                    join(__dirname, '../../../../package.json'), // from dist/main/main/services
                    join(__dirname, '../../../package.json'),
                    join(process.cwd(), 'package.json'),
                ]
                : [join(electron_1.app.getAppPath(), 'package.json')];
            for (const path of possiblePaths) {
                try {
                    const packageJson = JSON.parse(readFileSync(path, 'utf-8'));
                    if (packageJson.name === 'emdash' && packageJson.version) {
                        return packageJson.version;
                    }
                }
                catch {
                    continue;
                }
            }
            // Fallback: hardcoded version for dev
            return '0.3.46';
        }
        catch {
            return '0.3.46';
        }
    }
    /**
     * Initialize the auto-update service
     */
    async initialize() {
        if (this.initialized)
            return;
        // Skip auto-updates in development - always
        const isDev = !electron_1.app.isPackaged || process.env.NODE_ENV === 'development';
        if (isDev) {
            // Silent in dev - no logs
            this.initialized = true;
            return;
        }
        this.initialized = true;
        // Setup and configure autoUpdater only for production
        this.setupAutoUpdater();
        // Load settings from database
        await this.loadSettings();
        // Configure auto-updater based on settings
        this.applySettings();
        // Setup event listeners
        this.setupEventListeners();
        // Schedule initial update check after startup delay
        if (this.settings.autoCheck) {
            this.scheduleUpdateCheck(UPDATE_CHECK_INTERVALS.startup);
        }
        logger_1.log.info('AutoUpdateService initialized', {
            version: this.updateState.currentVersion,
            channel: this.settings.channel,
            autoCheck: this.settings.autoCheck,
            autoDownload: this.settings.autoDownload,
        });
    }
    /**
     * Setup electron-updater configuration
     */
    setupAutoUpdater() {
        // Basic configuration
        electron_updater_1.autoUpdater.autoDownload = false; // We'll manage downloads manually
        electron_updater_1.autoUpdater.autoInstallOnAppQuit = true;
        electron_updater_1.autoUpdater.autoRunAppAfterInstall = true;
        // Ensure we always get the latest version info, bypassing caches
        electron_updater_1.autoUpdater.requestHeaders = { 'Cache-Control': 'no-cache' };
        // Custom logger for production
        electron_updater_1.autoUpdater.logger = {
            info: (...args) => logger_1.log.debug('[autoUpdater]', ...(0, updaterError_1.sanitizeUpdaterLogArgs)(args)),
            warn: (...args) => logger_1.log.warn('[autoUpdater]', ...(0, updaterError_1.sanitizeUpdaterLogArgs)(args)),
            error: (...args) => logger_1.log.error('[autoUpdater]', ...(0, updaterError_1.sanitizeUpdaterLogArgs)(args)),
        };
    }
    /**
     * Setup event listeners for auto-updater
     */
    setupEventListeners() {
        electron_updater_1.autoUpdater.on('checking-for-update', () => {
            this.updateState.status = 'checking';
            this.updateState.lastCheck = new Date();
            this.notifyWindows('checking');
        });
        electron_updater_1.autoUpdater.on('update-available', (info) => {
            this.updateState.status = 'available';
            this.updateState.availableVersion = info.version;
            this.updateState.updateInfo = info;
            this.notifyWindows('available', info);
            // Auto-download if enabled and not already notified about this version
            if (this.settings.autoDownload && info.version !== this.lastNotifiedVersion) {
                this.lastNotifiedVersion = info.version;
                setTimeout(() => this.downloadUpdate(), 2000); // Small delay for UI to update
            }
        });
        electron_updater_1.autoUpdater.on('update-not-available', (info) => {
            this.updateState.status = 'idle';
            this.scheduleNextCheck();
            this.notifyWindows('not-available', info);
        });
        electron_updater_1.autoUpdater.on('error', (err) => {
            const errorMessage = (0, updaterError_1.formatUpdaterError)(err);
            logger_1.log.error('Auto-updater error:', errorMessage);
            // Don't let stale errors clobber an active install
            if (this.updateState.status === 'installing') {
                logger_1.log.warn('Ignoring auto-updater error while install is in progress');
                return;
            }
            // Preserve update info if we have it
            const previousVersion = this.updateState.availableVersion;
            const previousInfo = this.updateState.updateInfo;
            this.updateState.status = 'error';
            this.updateState.error = errorMessage;
            // Keep the update info so user can retry
            if (previousVersion) {
                this.updateState.availableVersion = previousVersion;
                this.updateState.updateInfo = previousInfo;
            }
            this.notifyWindows('error', { message: errorMessage });
            // Don't automatically retry on error - let user decide
        });
        electron_updater_1.autoUpdater.on('download-progress', (progressObj) => {
            this.updateState.status = 'downloading';
            // Calculate remaining time
            const now = Date.now();
            let remainingTime;
            if (this.downloadStartTime && progressObj.bytesPerSecond > 0) {
                const elapsedSeconds = (now - this.downloadStartTime) / 1000;
                const totalSeconds = progressObj.total / progressObj.bytesPerSecond;
                remainingTime = Math.max(0, totalSeconds - elapsedSeconds);
            }
            this.updateState.downloadProgress = {
                bytesPerSecond: progressObj.bytesPerSecond,
                percent: progressObj.percent,
                transferred: progressObj.transferred,
                total: progressObj.total,
                remainingTime,
            };
            this.notifyWindows('download-progress', progressObj);
        });
        electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
            this.updateState.status = 'downloaded';
            this.downloadStartTime = undefined;
            this.notifyWindows('downloaded', info);
            // Store rollback info
            this.updateState.rollbackVersion = this.updateState.currentVersion;
        });
    }
    /**
     * Load settings from environment variables
     */
    async loadSettings() {
        try {
            // Load from environment variables (settings persist in memory during session)
            const envChannel = process.env.EMDASH_UPDATE_CHANNEL;
            if (envChannel && Object.values(UpdateChannel).includes(envChannel)) {
                this.settings.channel = envChannel;
            }
            const envAutoCheck = process.env.EMDASH_AUTO_CHECK_UPDATES;
            if (envAutoCheck === 'false') {
                this.settings.autoCheck = false;
            }
            const envAutoDownload = process.env.EMDASH_AUTO_DOWNLOAD_UPDATES;
            if (envAutoDownload === 'true') {
                this.settings.autoDownload = true;
            }
        }
        catch (error) {
            logger_1.log.error('Failed to load update settings:', error);
        }
    }
    /**
     * Apply current settings to auto-updater
     */
    applySettings() {
        // Set update channel
        if (this.settings.channel !== UpdateChannel.STABLE) {
            electron_updater_1.autoUpdater.channel = this.settings.channel;
        }
        // Set prerelease flag
        electron_updater_1.autoUpdater.allowPrerelease = this.settings.allowPrerelease;
        // Set downgrade flag
        electron_updater_1.autoUpdater.allowDowngrade = this.settings.allowDowngrade;
    }
    /**
     * Schedule an update check
     */
    scheduleUpdateCheck(delay) {
        // Clear existing timer
        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
        }
        if (delay > 0) {
            this.updateState.nextCheck = new Date(Date.now() + delay);
            this.checkTimer = setTimeout(() => {
                this.checkForUpdates(true); // Silent check
            }, delay);
        }
        else {
            this.checkForUpdates(false); // Immediate check
        }
    }
    /**
     * Schedule the next periodic check
     */
    scheduleNextCheck() {
        if (this.settings.autoCheck) {
            this.scheduleUpdateCheck(this.settings.checkInterval);
        }
    }
    /**
     * Check for updates
     */
    async checkForUpdates(silent = false) {
        try {
            // Skip in development - always
            const isDev = !electron_1.app.isPackaged || process.env.NODE_ENV === 'development';
            if (isDev) {
                return null;
            }
            // Clear error state when checking again
            if (this.updateState.status === 'error') {
                this.updateState.status = 'idle';
                this.updateState.error = undefined;
            }
            logger_1.log.info('Checking for updates...', {
                channel: this.settings.channel,
                currentVersion: this.updateState.currentVersion,
            });
            const result = await electron_updater_1.autoUpdater.checkForUpdatesAndNotify();
            // Schedule next check
            this.scheduleNextCheck();
            return result?.updateInfo || null;
        }
        catch (error) {
            const errorMessage = (0, updaterError_1.formatUpdaterError)(error);
            logger_1.log.error('Update check failed:', errorMessage, error);
            this.updateState.status = 'error';
            this.updateState.error = errorMessage;
            if (!silent) {
                this.notifyWindows('error', { message: errorMessage });
            }
            // Schedule retry
            this.scheduleNextCheck();
            return null;
        }
    }
    /**
     * Download the available update
     */
    async downloadUpdate() {
        try {
            // If we're in error state but have update info, we can retry
            if (this.updateState.status === 'error' && this.updateState.availableVersion) {
                this.updateState.status = 'available';
            }
            if (this.updateState.status !== 'available') {
                throw new Error(`Cannot download: status is "${this.updateState.status}", not "available"`);
            }
            if (!this.updateState.availableVersion) {
                throw new Error('No version information available for download');
            }
            this.downloadStartTime = Date.now();
            // Notify UI that download is starting
            this.updateState.status = 'downloading';
            this.notifyWindows('downloading', { version: this.updateState.availableVersion });
            await electron_updater_1.autoUpdater.downloadUpdate();
        }
        catch (error) {
            const errorMessage = (0, updaterError_1.formatUpdaterError)(error);
            logger_1.log.error('Update download failed:', errorMessage, error);
            // Keep the version info for retry
            const version = this.updateState.availableVersion;
            const info = this.updateState.updateInfo;
            this.updateState.status = 'error';
            this.updateState.error = errorMessage;
            this.updateState.availableVersion = version;
            this.updateState.updateInfo = info;
            this.downloadStartTime = undefined;
            this.notifyWindows('error', { message: errorMessage });
            throw error; // Re-throw to ensure it's caught by IPC handler
        }
    }
    /**
     * Install the downloaded update and restart
     */
    quitAndInstall() {
        if (this.installRequested) {
            logger_1.log.info('quitAndInstall ignored: install already requested');
            return;
        }
        if (this.updateState.status !== 'downloaded') {
            throw new Error(`Cannot install update: status is "${this.updateState.status}", expected "downloaded"`);
        }
        this.installRequested = true;
        this.updateState.status = 'installing';
        this.notifyWindows('installing');
        // Save current state for potential rollback
        this.saveRollbackInfo();
        const clearGuard = () => {
            if (this.installRestartGuardTimer) {
                clearTimeout(this.installRestartGuardTimer);
                this.installRestartGuardTimer = undefined;
            }
        };
        const rollback = (reason) => {
            clearGuard();
            this.installRequested = false;
            this.updateState.status = 'downloaded';
            this.notifyWindows('downloaded', this.updateState.updateInfo);
            logger_1.log.error(reason);
        };
        // If the app hasn't quit after 2 minutes, roll back so the user can retry
        this.installRestartGuardTimer = setTimeout(() => {
            rollback('quitAndInstall timed out before app quit; allowing retry');
        }, INSTALL_RESTART_GUARD_TIMEOUT_MS);
        // Small delay to ensure UI can respond
        setTimeout(() => {
            try {
                electron_updater_1.autoUpdater.quitAndInstall(false, true);
            }
            catch (error) {
                rollback(`quitAndInstall threw: ${(0, updaterError_1.formatUpdaterError)(error)}`);
            }
        }, 250);
    }
    /**
     * Save rollback information
     */
    saveRollbackInfo() {
        try {
            // Log rollback information for debugging purposes
            logger_1.log.info('Saving rollback info:', {
                fromVersion: this.updateState.currentVersion,
                toVersion: this.updateState.availableVersion,
            });
        }
        catch (error) {
            logger_1.log.error('Failed to save rollback info:', error);
        }
    }
    /**
     * Fetch release notes for the available update
     */
    async fetchReleaseNotes() {
        try {
            if (!this.updateState.updateInfo) {
                return null;
            }
            // Try to get from updateInfo first
            const releaseNotes = this.updateState.updateInfo.releaseNotes;
            if (releaseNotes) {
                this.updateState.releaseNotes = releaseNotes;
                return releaseNotes;
            }
            // Otherwise fetch from GitHub API
            const version = this.updateState.availableVersion;
            if (!version)
                return null;
            const response = await fetch(`https://api.github.com/repos/generalaction/emdash/releases/tags/v${version}`);
            if (response.ok) {
                const data = (await response.json());
                const notes = data.body || 'No release notes available';
                this.updateState.releaseNotes = notes;
                return notes;
            }
            return null;
        }
        catch (error) {
            logger_1.log.error('Failed to fetch release notes:', error);
            return null;
        }
    }
    /**
     * Update user settings
     */
    async updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        // Apply new settings
        this.applySettings();
        // Settings persist in memory for the current session
        // Reschedule checks if needed
        if (this.settings.autoCheck) {
            this.scheduleNextCheck();
        }
        else if (this.checkTimer) {
            clearTimeout(this.checkTimer);
            this.checkTimer = undefined;
        }
        logger_1.log.info('Update settings changed:', this.settings);
    }
    /**
     * Get current update state
     */
    getState() {
        return { ...this.updateState };
    }
    /**
     * Get current settings
     */
    getSettings() {
        return { ...this.settings };
    }
    /**
     * Notify all windows about update events
     */
    notifyWindows(event, payload) {
        const channel = `update:${event}`;
        for (const win of electron_1.BrowserWindow.getAllWindows()) {
            try {
                win.webContents.send(channel, payload);
            }
            catch {
                // Window might be destroyed
            }
        }
    }
    /**
     * Format bytes to human readable string
     */
    formatBytes(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }
    /**
     * Format time to human readable string
     */
    formatTime(seconds) {
        if (seconds < 60)
            return `${Math.round(seconds)}s`;
        if (seconds < 3600)
            return `${Math.round(seconds / 60)}m`;
        return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
    }
    /**
     * Cleanup on shutdown
     */
    shutdown() {
        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
            this.checkTimer = undefined;
        }
        if (this.installRestartGuardTimer) {
            clearTimeout(this.installRestartGuardTimer);
            this.installRestartGuardTimer = undefined;
        }
    }
}
// Export singleton instance
exports.autoUpdateService = new AutoUpdateService();
