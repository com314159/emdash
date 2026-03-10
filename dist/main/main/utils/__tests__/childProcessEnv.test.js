"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const childProcessEnv_1 = require("../childProcessEnv");
(0, vitest_1.describe)('buildExternalToolEnv', () => {
    (0, vitest_1.it)('removes AppImage-only keys and strips mount paths from PATH-like vars', () => {
        const env = (0, childProcessEnv_1.buildExternalToolEnv)({
            APPDIR: '/tmp/.mount_emdashAbCd',
            APPIMAGE: '/home/user/emdash.AppImage',
            ARGV0: 'AppRun',
            CHROME_DESKTOP: 'emdash.desktop',
            GSETTINGS_SCHEMA_DIR: '/tmp/.mount_emdashAbCd/usr/share/glib-2.0/schemas',
            OWD: '/tmp',
            PATH: '/usr/local/bin:/tmp/.mount_emdashAbCd/usr/bin:/usr/bin',
            LD_LIBRARY_PATH: '/tmp/.mount_emdashAbCd/usr/lib:/usr/local/cuda/lib64',
            XDG_DATA_DIRS: '/tmp/.mount_emdashAbCd/usr/share:/usr/share',
            HOME: '/home/user',
            USER: 'user',
            KEEP_ME: 'yes',
        });
        (0, vitest_1.expect)(env.APPDIR).toBeUndefined();
        (0, vitest_1.expect)(env.APPIMAGE).toBeUndefined();
        (0, vitest_1.expect)(env.ARGV0).toBeUndefined();
        (0, vitest_1.expect)(env.CHROME_DESKTOP).toBeUndefined();
        (0, vitest_1.expect)(env.GSETTINGS_SCHEMA_DIR).toBeUndefined();
        (0, vitest_1.expect)(env.OWD).toBeUndefined();
        (0, vitest_1.expect)(env.PATH).toBe('/usr/local/bin:/usr/bin');
        (0, vitest_1.expect)(env.LD_LIBRARY_PATH).toBe('/usr/local/cuda/lib64');
        (0, vitest_1.expect)(env.XDG_DATA_DIRS).toBe('/usr/share');
        (0, vitest_1.expect)(env.HOME).toBe('/home/user');
        (0, vitest_1.expect)(env.USER).toBe('user');
        (0, vitest_1.expect)(env.KEEP_ME).toBe('yes');
    });
    (0, vitest_1.it)('removes Python vars only when they point into AppImage mount paths', () => {
        const stripped = (0, childProcessEnv_1.buildExternalToolEnv)({
            APPDIR: '/tmp/.mount_emdashZZ',
            PYTHONHOME: '/tmp/.mount_emdashZZ/usr',
            PYTHONPATH: '/tmp/.mount_emdashZZ/usr/lib/python3.11',
        });
        (0, vitest_1.expect)(stripped.PYTHONHOME).toBeUndefined();
        (0, vitest_1.expect)(stripped.PYTHONPATH).toBeUndefined();
        const kept = (0, childProcessEnv_1.buildExternalToolEnv)({
            PYTHONHOME: '/opt/python',
            PYTHONPATH: '/opt/python/lib',
        });
        (0, vitest_1.expect)(kept.PYTHONHOME).toBe('/opt/python');
        (0, vitest_1.expect)(kept.PYTHONPATH).toBe('/opt/python/lib');
    });
});
