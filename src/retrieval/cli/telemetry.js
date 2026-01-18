import { observeSearchDuration } from '../../shared/metrics.js';

export function createSearchTelemetry() {
  const metricsStart = process.hrtime.bigint();
  let metricsRecorded = false;
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
  return {
    setMode: (mode) => { metricsMode = mode; },
    setBackend: (backend) => { metricsBackend = backend; },
    setAnn: (ann) => { metricsAnn = ann; },
    record: recordSearchMetrics
  };
}
