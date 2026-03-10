"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureWithTiming = captureWithTiming;
const telemetry_1 = require("../telemetry");
/**
 * Capture telemetry event with timing duration.
 * Automatically clamps duration to reasonable bounds and includes it in properties.
 */
async function captureWithTiming(event, operation, additionalProps) {
    const start = Date.now();
    try {
        const result = await operation();
        const duration = Date.now() - start;
        void (0, telemetry_1.capture)(event, {
            ...additionalProps,
            duration_ms: duration,
        });
        return result;
    }
    catch (error) {
        const duration = Date.now() - start;
        void (0, telemetry_1.capture)(event, {
            ...additionalProps,
            duration_ms: duration,
        });
        throw error;
    }
}
