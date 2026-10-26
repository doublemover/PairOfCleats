import { isSupportedScanProfileVersion } from '../../../src/contracts/scan-profile.js';
import { BENCH_MEASUREMENT_SNAPSHOT_VERSION } from '../../bench/language/metrics/recorded-contract.js';
import { readBenchSkipReceipt } from '../../bench/runner-outcome.js';
export const THROUGHPUT_REPORT_VERSION = 2;
export const THROUGHPUT_COMPARISON_VERSION = 2;
export const THROUGHPUT_INPUT_VERSION = 1;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const measured = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const numericRecord = value => object(value) && Object.values(value).some(entry => measured(entry) || object(entry) && Object.values(entry).some(measured));
const measuredSummary = summary => object(summary) && (
  ['queries', 'queryWallMs', 'queryWallMsPerQuery', 'queryWallMsPerSearch'].some(key => typeof summary[key] === 'number' && Number.isFinite(summary[key]) && summary[key] >= 0)
  || ['buildMs', 'latencyMs', 'latencyMsAvg', 'hitRate', 'resultCountAvg', 'memoryRss'].some(key => numericRecord(summary[key]))
);

const failedSummary = value => object(value) && (['failed', 'error', 'cancelled', 'timeout', 'empty'].includes(value.status)
  || nonempty(value.error) || object(value.error) && nonempty(value.error.code));
const runSummary = value => measuredSummary(value) || failedSummary(value);

/** Supported legacy envelopes are recognized by their measurement structure,
 * not merely a date, filename or truthy parsed JSON. Zero/failed runs survive. */
export const classifyThroughputInput = value => {
  if (!object(value)) return 'unsupported-envelope';
  if (Array.isArray(value.folders) && object(value.ciSummary)
    || object(value.runner) && Array.isArray(value.results)
    || value.kind === 'bench-terminal' && nonempty(value.benchmark) && readBenchSkipReceipt(JSON.stringify(value), value.benchmark)
    || value.schemaVersion === BENCH_MEASUREMENT_SNAPSHOT_VERSION && nonempty(value.attemptId) && (object(value.metricsByMode) || object(value.featureMetrics))) return 'recognized-non-run';
  const repo = nonempty(value.repo?.root) || nonempty(value.artifacts?.repo?.root);
  if (Object.hasOwn(value, 'runs') && (!Array.isArray(value.runs) || !value.runs.every(runSummary))
    || Object.hasOwn(value, 'summary') && value.summary !== null && !object(value.summary)) return 'unsupported-envelope';
  const canonical = repo && Array.isArray(value.runs) && Object.hasOwn(value, 'summary')
    && (value.summary === null || runSummary(value.summary));
  const failure = repo && ['failed', 'error', 'cancelled', 'timeout', 'empty'].includes(value.status || value.summary?.status);
  const artifacts = value.artifacts;
  const observedArtifacts = object(artifacts) && (object(artifacts.throughput) && Object.values(artifacts.throughput).some(numericRecord)
    || object(artifacts.scanProfile?.modes) && isSupportedScanProfileVersion(artifacts.scanProfile.schemaVersion) && Object.values(artifacts.scanProfile.modes).some(numericRecord)
    || object(artifacts.indexing?.modes) && artifacts.indexing.schemaVersion === 1 && Object.values(artifacts.indexing.modes).some(numericRecord));
  if (!canonical && !failure && !measuredSummary(value.summary) && !(Array.isArray(value.runs) && value.runs.some(measuredSummary)) && !observedArtifacts) return 'unsupported-envelope';
  if (value.schemaVersion != null && value.schemaVersion !== 1) return 'unsupported-version';
  return 'supported-run';
};

export const admitThroughputReport = value => {
  if (!object(value) || value.schemaVersion !== THROUGHPUT_REPORT_VERSION || !Array.isArray(value.folders)
    || !nonempty(value.root) || !['overview', 'compare', 'repo', 'family', 'raw'].includes(value.profile)
    || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))
    || !object(value.ciSummary) || value.ciSummary.folderCount !== value.folders.length) return { ok: false, reason: 'unsupported-report-envelope' };
  const input = value.inputAdmission;
  if (!object(input) || input.version !== THROUGHPUT_INPUT_VERSION || input.scope !== 'selected-result-file-cohort' || input.complete !== true
    || input.cancelled || input.inventoryComplete !== true || input.failures !== 0 || !['complete', 'empty'].includes(input.state)
    || !['discovered', 'selected', 'admitted', 'processed', 'excluded'].every(key => Number.isSafeInteger(input[key]) && input[key] >= 0)
    || input.processed !== input.admitted || input.admitted !== input.selected) return { ok: false, reason: 'incomplete-input-cohort' };
  if (!Array.isArray(input.folders) || !input.folders.every(folder => object(folder) && folder.inventoryComplete === true && Array.isArray(folder.files))) return { ok: false, reason: 'incomplete-input-inventory' };
  const files = input.folders.flatMap(folder => folder.files);
  if (input.excluded !== input.discovered - input.selected || files.length !== input.discovered || files.some(file => !object(file) || !['supported-run', 'recognized-non-run'].includes(file.state))
    || files.some(file => file.selected === true ? file.state !== 'supported-run' || !file.admitted || !file.processed : file.admitted || file.processed)
    || files.filter(file => file.selected === true).length !== input.selected
    || files.filter(file => file.admitted === true).length !== input.admitted
    || files.filter(file => file.processed === true).length !== input.processed) return { ok: false, reason: 'inconsistent-input-receipt' };
  return { ok: true, empty: input.processed === 0 };
};

export const admitThroughputBaselineChild = result => {
  if (result?.exitCode !== 0 || result.signal) return { ok: false, reason: 'baseline-child-failed' };
  const capture = result.outputCapture?.stdout;
  if (!capture?.enabled || capture.truncated || capture.encodingLoss || capture.droppedBytes !== 0) return { ok: false, reason: 'baseline-capture-incomplete' };
  let report;
  try { report = JSON.parse(result.stdout); } catch { return { ok: false, reason: 'baseline-malformed' }; }
  const admission = admitThroughputReport(report);
  return admission.ok ? { ...admission, report } : admission;
};
