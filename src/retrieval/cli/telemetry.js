import { observeSearchDuration } from '../../shared/metrics.js';
import {
  RESOURCE_GROWTH_THRESHOLDS,
  RESOURCE_WARNING_CODES,
  captureProcessMemoryRss,
  evaluateResourceGrowth,
  formatResourceGrowthWarning
} from '../../shared/ops-resource-visibility.js';

/**
 * Build per-search telemetry recorders.
 * `emitResourceWarnings` is intentionally one-shot so repeated cleanup paths
 * cannot duplicate abnormal-growth warnings for the same run.
 * @param {{readRss?:(()=>number)|null}} [input]
 * @returns {{
 *   setMode:(mode:string)=>void,
 *   setBackend:(backend:string)=>void,
 *   setAnn:(ann:string|boolean)=>void,
 *   record:(status:string)=>void,
 *   emitResourceWarnings:(input?:{warn?:(message:string)=>void})=>any
 * }}
 */
export function createSearchTelemetry({ readRss = null } = {}) {
  const resolveRss = typeof readRss === 'function'
    ? readRss
    : captureProcessMemoryRss;
  const metricsStart = process.hrtime.bigint();
  const rssStart = resolveRss();
  let metricsRecorded = false;
  let resourceWarningRecorded = false;
  let metricsMode = 'unknown';
  let metricsBackend = 'unknown';
  let metricsAnn = 'unknown';
  const recordSearchMetrics = (status) => {
    if (metricsRecorded) return;
    metricsRecorded = true;
    const elapsed = Number(process.hrtime.bigint() - metricsStart) / 1e9;
    try {
      observeSearchDuration({
        mode: metricsMode,
        backend: metricsBackend,
        ann: metricsAnn,
        status,
        seconds: elapsed
      });
    } catch {}
  };
  const emitResourceWarnings = ({ warn = null } = {}) => {
    if (resourceWarningRecorded) return null;
    resourceWarningRecorded = true;
    const growth = evaluateResourceGrowth({
      baselineBytes: rssStart,
      currentBytes: resolveRss(),
      ratioThreshold: RESOURCE_GROWTH_THRESHOLDS.retrievalRssRatio,
      deltaThresholdBytes: RESOURCE_GROWTH_THRESHOLDS.retrievalRssDeltaBytes
    });
    if (!growth.abnormal) return growth;
    const message = formatResourceGrowthWarning({
      code: RESOURCE_WARNING_CODES.RETRIEVAL_MEMORY_GROWTH_ABNORMAL,
      component: 'retrieval',
      metric: 'rss',
      growth,
      nextAction: 'Profile retrieval hot path and reduce working-set growth.'
    });
    if (typeof warn === 'function') warn(message);
    return growth;
  };
  return {
    setMode: (mode) => { metricsMode = mode; },
    setBackend: (backend) => { metricsBackend = backend; },
    setAnn: (ann) => { metricsAnn = ann; },
    record: recordSearchMetrics,
    emitResourceWarnings
  };
}
