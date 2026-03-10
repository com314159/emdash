"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCatalog = loadCatalog;
exports.getCatalogServerConfig = getCatalogServerConfig;
const catalog_1 = require("@shared/mcp/catalog");
function loadCatalog() {
    return Object.entries(catalog_1.catalogData).map(([key, entry]) => ({
        key,
        name: entry.name,
        description: entry.description,
        docsUrl: entry.docsUrl,
        defaultConfig: entry.config,
        credentialKeys: entry.credentialKeys,
    }));
}
function getCatalogServerConfig(key) {
    return catalog_1.catalogData[key]?.config;
}
