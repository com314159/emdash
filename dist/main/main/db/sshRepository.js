"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SshRepository = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const drizzleClient_1 = require("./drizzleClient");
const schema_1 = require("./schema");
class SshRepository {
    static getInstance() {
        if (!SshRepository.instance) {
            SshRepository.instance = new SshRepository();
        }
        return SshRepository.instance;
    }
    async createConnection(data) {
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const id = `ssh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const result = await db
            .insert(schema_1.sshConnections)
            .values({
            ...data,
            id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        })
            .returning();
        return result[0];
    }
    async getConnection(id) {
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const result = await db.select().from(schema_1.sshConnections).where((0, drizzle_orm_1.eq)(schema_1.sshConnections.id, id));
        return result[0];
    }
    async getAllConnections() {
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        return db.select().from(schema_1.sshConnections);
    }
    async updateConnection(id, data) {
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const result = await db
            .update(schema_1.sshConnections)
            .set({
            ...data,
            updatedAt: new Date().toISOString(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.sshConnections.id, id))
            .returning();
        return result[0];
    }
    async deleteConnection(id) {
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        // First update any projects using this connection
        await db
            .update(schema_1.projects)
            .set({ sshConnectionId: null, isRemote: 0 })
            .where((0, drizzle_orm_1.eq)(schema_1.projects.sshConnectionId, id));
        // Then delete the connection
        await db.delete(schema_1.sshConnections).where((0, drizzle_orm_1.eq)(schema_1.sshConnections.id, id));
    }
    async getProjectsForConnection(connectionId) {
        const { db } = await (0, drizzleClient_1.getDrizzleClient)();
        const result = await db
            .select({ id: schema_1.projects.id })
            .from(schema_1.projects)
            .where((0, drizzle_orm_1.eq)(schema_1.projects.sshConnectionId, connectionId));
        return result.map((r) => r.id);
    }
}
exports.SshRepository = SshRepository;
