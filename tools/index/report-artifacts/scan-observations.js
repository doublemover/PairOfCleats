import { SCAN_PROFILE_COVERAGE_VERSION, SCAN_PROFILE_MODES } from '../../../src/contracts/scan-profile.js';

/** Scan artifacts carry JSON numbers. Numeric strings, booleans, null and
 * nonfinite/negative values are unknown; observed zero stays observed. */
export const observedScanNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const observedScanCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const observedScanRate = (count, elapsedMs) => {
  const total = observedScanNumber(count), elapsed = observedScanNumber(elapsedMs);
  if (total === null || elapsed === null || elapsed <= 0) return null;
  const rate = total / (elapsed / 1000);
  return Number.isFinite(rate) ? rate : null;
};

export const buildObservedThroughput = (mode, metrics, bytes) => {
  if (!metrics) return null;
  const payload = { mode, totalMs: observedScanNumber(metrics.timings?.totalMs), writeMs: observedScanNumber(metrics.timings?.writeMs),
    files: observedScanCount(metrics.files?.candidates), chunks: observedScanCount(metrics.chunks?.total),
    tokens: observedScanCount(metrics.tokens?.total), bytes: observedScanCount(bytes) };
  for (const [rate, count] of [['filesPerSec', 'files'], ['chunksPerSec', 'chunks'], ['tokensPerSec', 'tokens'], ['bytesPerSec', 'bytes']]) {
    payload[rate] = observedScanRate(payload[count], payload.totalMs);
  }
  payload.writeBytesPerSec = observedScanRate(payload.bytes, payload.writeMs);
  return payload;
};

const counterValue = (mode, key) => ({
  'files.candidates': mode.files?.candidates, 'files.scanned': mode.files?.scanned, 'files.skipped': mode.files?.skipped,
  chunks: mode.chunks?.total, tokens: mode.tokens?.total, lines: mode.lines?.total,
  'bytes.source': mode.bytes?.source, 'bytes.artifact': mode.bytes?.artifact, durationMs: mode.throughput?.totalMs
})[key];
export const observedScanModes = modes => SCAN_PROFILE_MODES.filter(key => {
  const mode = modes[key];
  return mode && (typeof mode.indexDir === 'string'
    || ['files.candidates', 'files.scanned', 'files.skipped', 'chunks', 'tokens', 'lines', 'bytes.source', 'bytes.artifact', 'durationMs']
      .some(counter => observedScanNumber(counterValue(mode, counter)) !== null));
});
const sum = (values, integer = false) => {
  if (!values.length) return null;
  const total = values.reduce((a, b) => a + b, 0);
  return integer ? observedScanCount(total) : observedScanNumber(total);
};
const stateFor = (observed, required) => !observed || !required ? 'unknown' : observed === required ? 'complete' : 'partial';
const RATE_COUNTER = { filesPerSec: 'files.candidates', chunksPerSec: 'chunks', tokensPerSec: 'tokens', bytesPerSec: 'bytes.artifact', linesPerSec: 'lines' };

/** Totals describe summed mode work, never unique repository work or wall time.
 * Whole totals/rates require every selected mode. Matched-subset observations
 * retain their own numerator and denominator instead of borrowing all timing. */
export const summarizeScanObservations = (modes, declaredModes = observedScanModes(modes)) => {
  const presentModes = observedScanModes(modes);
  const requiredModes = SCAN_PROFILE_MODES.filter(mode => declaredModes.includes(mode) || presentModes.includes(mode));
  const coverage = { version: SCAN_PROFILE_COVERAGE_VERSION, scope: 'sum-of-mode-work',
    durationScope: 'sum-of-mode-total-ms', requiredModes, counters: {}, rates: {} };
  const totals = { files: {}, chunks: null, tokens: null, lines: null, bytes: {}, durationMs: null };
  for (const key of ['files.candidates', 'files.scanned', 'files.skipped', 'chunks', 'tokens', 'lines', 'bytes.source', 'bytes.artifact', 'durationMs']) {
    const admit = key === 'durationMs' ? observedScanNumber : observedScanCount;
    const observedModes = requiredModes.filter(mode => admit(counterValue(modes[mode] || {}, key)) !== null);
    const observedTotal = sum(observedModes.map(mode => counterValue(modes[mode], key)), key !== 'durationMs');
    const state = observedTotal === null ? 'unknown' : stateFor(observedModes.length, requiredModes.length);
    coverage.counters[key] = { state, observedModes, missingModes: requiredModes.filter(mode => !observedModes.includes(mode)), observedTotal };
    const value = state === 'complete' ? observedTotal : null;
    const [parent, child] = key.split('.');
    if (child) totals[parent][child] = value; else totals[key] = value;
  }
  for (const [rate, key] of Object.entries(RATE_COUNTER)) {
    const includedModes = requiredModes.filter(mode => observedScanRate(observedScanCount(counterValue(modes[mode] || {}, key)),
      modes[mode]?.throughput?.totalMs) !== null);
    const numerator = sum(includedModes.map(mode => counterValue(modes[mode], key)), true);
    const durationMs = sum(includedModes.map(mode => modes[mode].throughput.totalMs));
    const measuredSubsetPerSec = observedScanRate(numerator, durationMs);
    const state = measuredSubsetPerSec === null ? 'unknown' : stateFor(includedModes.length, requiredModes.length);
    coverage.rates[rate] = { state, includedModes, excludedModes: requiredModes.filter(mode => !includedModes.includes(mode)),
      numerator, durationMs, measuredSubsetPerSec };
    totals[rate] = state === 'complete' ? measuredSubsetPerSec : null;
  }
  return { totals, coverage };
};
