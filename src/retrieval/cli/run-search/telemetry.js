import { createSearchTelemetry } from '../telemetry.js';

/**
 * Create run-search telemetry with the legacy record callback shape.
 *
 * @returns {{
 *   telemetry: ReturnType<typeof createSearchTelemetry>,
 *   recordSearchMetrics: (status:string)=>void
 * }}
 */
export const createRunSearchTelemetry = () => {
  const telemetry = createSearchTelemetry();
  return {
    telemetry,
    recordSearchMetrics: (status) => telemetry.record(status)
  };
};
