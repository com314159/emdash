"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSkillsIpc = registerSkillsIpc;
const electron_1 = require("electron");
const SkillsService_1 = require("../services/SkillsService");
const logger_1 = require("../lib/logger");
function registerSkillsIpc() {
    electron_1.ipcMain.handle('skills:getCatalog', async () => {
        try {
            const catalog = await SkillsService_1.skillsService.getCatalogIndex();
            return { success: true, data: catalog };
        }
        catch (error) {
            logger_1.log.error('Failed to get skills catalog:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('skills:refreshCatalog', async () => {
        try {
            const catalog = await SkillsService_1.skillsService.refreshCatalog();
            return { success: true, data: catalog };
        }
        catch (error) {
            logger_1.log.error('Failed to refresh skills catalog:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('skills:install', async (_, args) => {
        try {
            const skill = await SkillsService_1.skillsService.installSkill(args.skillId);
            return { success: true, data: skill };
        }
        catch (error) {
            logger_1.log.error('Failed to install skill:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('skills:uninstall', async (_, args) => {
        try {
            await SkillsService_1.skillsService.uninstallSkill(args.skillId);
            return { success: true };
        }
        catch (error) {
            logger_1.log.error('Failed to uninstall skill:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('skills:getDetail', async (_, args) => {
        try {
            const skill = await SkillsService_1.skillsService.getSkillDetail(args.skillId);
            return { success: true, data: skill };
        }
        catch (error) {
            logger_1.log.error('Failed to get skill detail:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('skills:getDetectedAgents', async () => {
        try {
            const agents = await SkillsService_1.skillsService.getDetectedAgents();
            return { success: true, data: agents };
        }
        catch (error) {
            logger_1.log.error('Failed to detect agents:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('skills:create', async (_, args) => {
        try {
            const skill = await SkillsService_1.skillsService.createSkill(args.name, args.description, args.content);
            return { success: true, data: skill };
        }
        catch (error) {
            logger_1.log.error('Failed to create skill:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
}
