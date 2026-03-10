"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLineCommentsIpc = registerLineCommentsIpc;
const electron_1 = require("electron");
const logger_1 = require("../lib/logger");
const DatabaseService_1 = require("../services/DatabaseService");
const lineComments_1 = require("../../shared/lineComments");
function registerLineCommentsIpc() {
    electron_1.ipcMain.handle('lineComments:create', async (_, input) => {
        try {
            const id = await DatabaseService_1.databaseService.saveLineComment(input);
            return { success: true, id };
        }
        catch (error) {
            logger_1.log.error('Failed to create line comment:', error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('lineComments:get', async (_, args) => {
        try {
            const comments = await DatabaseService_1.databaseService.getLineComments(args.taskId, args.filePath);
            return { success: true, comments };
        }
        catch (error) {
            logger_1.log.error('Failed to get line comments:', error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('lineComments:update', async (_, input) => {
        try {
            await DatabaseService_1.databaseService.updateLineComment(input.id, input.content);
            return { success: true };
        }
        catch (error) {
            logger_1.log.error('Failed to update line comment:', error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('lineComments:delete', async (_, id) => {
        try {
            await DatabaseService_1.databaseService.deleteLineComment(id);
            return { success: true };
        }
        catch (error) {
            logger_1.log.error('Failed to delete line comment:', error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('lineComments:getFormatted', async (_, taskId) => {
        try {
            const comments = await DatabaseService_1.databaseService.getLineComments(taskId);
            const formatted = (0, lineComments_1.formatCommentsForAgent)(comments);
            return { success: true, formatted };
        }
        catch (error) {
            logger_1.log.error('Failed to format line comments:', error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('lineComments:markSent', async (_, commentIds) => {
        try {
            await DatabaseService_1.databaseService.markCommentsSent(commentIds);
            return { success: true };
        }
        catch (error) {
            logger_1.log.error('Failed to mark comments as sent:', error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('lineComments:getUnsent', async (_, taskId) => {
        try {
            const comments = await DatabaseService_1.databaseService.getUnsentComments(taskId);
            return { success: true, comments };
        }
        catch (error) {
            logger_1.log.error('Failed to get unsent comments:', error);
            return { success: false, error: error.message };
        }
    });
}
