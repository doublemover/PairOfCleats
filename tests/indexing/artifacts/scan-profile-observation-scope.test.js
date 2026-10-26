import assert from 'node:assert/strict';
import { validateArtifact } from '../../../src/contracts/artifact-schemas.js';
import { SCAN_PROFILE_SCHEMA_VERSION } from '../../../src/contracts/scan-profile.js';
import { buildScanProfile } from '../../../tools/index/report-artifacts/scan-profile.js';
import { buildObservedThroughput } from '../../../tools/index/report-artifacts/scan-observations.js';
import { buildIndexingSummaryFromScanProfile } from '../../../tools/reports/show-throughput/aggregate.js';
import { resolveIndexingSummary } from '../../../tools/reports/show-throughput/analysis.js';
import { resolveRecordedMeasurementInputs, BENCH_MEASUREMENT_DERIVATION_VERSION } from '../../../tools/bench/language/metrics/recorded-evidence.js';

const validate = profile => {
  const result = validateArtifact('scan_profile', profile);
  assert.equal(result.ok, true, (result.errors || []).join('; '));
  return profile;
};
const input = () => ({ artifactReport: { repo: { indexDirs: { code: '/fixture/code', prose: '/fixture/prose' },
  artifacts: { indexCode: 1000, indexProse: 1000 } } },
indexMetrics: { code: { files: { candidates: 1, scanned: 1, skipped: 0 }, chunks: { total: 2 }, tokens: { total: 10 }, timings: { totalMs: 1000 } },
  prose: { files: { candidates: null }, chunks: { total: null }, tokens: { total: null }, timings: { totalMs: 1000 } } },
featureMetrics: { modes: { code: { totals: { lines: 100, bytes: 500 }, languages: { javascript: { lines: 100 } } },
  prose: { totals: { lines: null, bytes: null } } } },
throughput: { code: { totalMs: 1000, filesPerSec: null }, prose: { totalMs: 1000, filesPerSec: null } } });
const partial = validate(buildScanProfile(input()));
assert.equal(partial.schemaVersion, SCAN_PROFILE_SCHEMA_VERSION);
assert.equal(partial.modes.code.throughput.linesPerSec, 100);
assert.equal(partial.modes.prose.lines.total, null);
assert.equal(partial.modes.prose.throughput.linesPerSec, null);
assert.equal(partial.modes.code.throughput.filesPerSec, 1, 'explicit null can fall back to matched observed counters');
assert.equal(partial.totals.lines, null);
assert.equal(partial.totals.linesPerSec, null, 'partial numerator cannot borrow both modes timing');
assert.equal(partial.totals.durationMs, 2000);
assert.equal(partial.coverage.counters.lines.state, 'partial');
assert.equal(partial.coverage.counters.lines.observedTotal, 100);
assert.deepEqual(partial.coverage.counters.lines.missingModes, ['prose']);
assert.deepEqual(partial.coverage.rates.linesPerSec, { state: 'partial', includedModes: ['code'], excludedModes: ['prose'],
  numerator: 100, durationMs: 1000, measuredSubsetPerSec: 100 });
const consumed = buildIndexingSummaryFromScanProfile(partial);
assert.equal(consumed.totals.lines, null);
assert.equal(consumed.totals.linesPerSec, null);
assert.equal(consumed.coverage.rates.linesPerSec.measuredSubsetPerSec, 100);
assert.equal(consumed.modes.prose.lines, null);
assert.equal(consumed.modes.prose.linesPerSec, null);
const recorded = resolveRecordedMeasurementInputs({ payload: { artifacts: { scanProfile: partial } } });
assert.equal(recorded.receipt.embeddedScanProfile, true, 'recorded evidence must recognize the new producer version');
assert.equal(recorded.metricsByMode.code.lines.total, 100);

const oldIndexing = structuredClone(consumed);
oldIndexing.totals.lines = 100; oldIndexing.totals.linesPerSec = 50;
oldIndexing.derivation = { derivationVersion: 1 };
const rebuilt = resolveIndexingSummary({ payload: { artifacts: { scanProfile: partial, indexing: oldIndexing } } });
assert.equal(rebuilt.indexingSummary.totals.linesPerSec, null, 'old materialization must not preserve the mixed denominator');
assert.equal(rebuilt.indexingSummary.derivation.derivationVersion, BENCH_MEASUREMENT_DERIVATION_VERSION);
assert.equal(oldIndexing.totals.linesPerSec, 50, 'read-only derivation does not rewrite historical input');

for (const bad of [null, undefined, false, true, '', '0', '100', NaN, Infinity, -1, 0.5]) {
  const given = input(); given.featureMetrics.modes.code.totals.lines = bad;
  given.indexMetrics.code.files.candidates = bad;
  given.indexMetrics.code.cache = { hits: bad, misses: bad, hitRate: bad };
  given.throughput.code.filesPerSec = null;
  const result = validate(buildScanProfile(given));
  assert.equal(result.modes.code.lines.total, null, `unknown line count: ${String(bad)}`);
  assert.equal(result.modes.code.throughput.linesPerSec, null);
  assert.equal(result.modes.code.throughput.filesPerSec, null);
  assert.equal(result.modes.code.cache.hits, null);
  assert.equal(result.modes.code.cache.misses, null);
  if (bad !== 0.5) assert.equal(result.modes.code.cache.hitRate, null);
}
const emptyInput = { artifactReport: { repo: { indexDirs: { code: '/fixture/code' }, artifacts: { indexCode: 0 } } },
  indexMetrics: { code: { files: { candidates: 0, scanned: 0, skipped: 0 }, chunks: { total: 0 }, tokens: { total: 0 },
    timings: { totalMs: 1000, writeMs: 1000 }, cache: { hits: 0, misses: 0, hitRate: 0 } } },
  featureMetrics: { modes: { code: { totals: { lines: 0, bytes: 0 } } } }, throughput: {} };
const empty = validate(buildScanProfile(emptyInput));
assert.equal(empty.totals.lines, 0); assert.equal(empty.totals.linesPerSec, 0);
assert.equal(empty.totals.files.candidates, 0); assert.equal(empty.totals.chunks, 0);
assert.equal(empty.totals.tokens, 0); assert.equal(empty.totals.bytes.artifact, 0);
assert.equal(empty.modes.code.cache.hitRate, 0);
assert.equal(empty.coverage.counters.lines.state, 'complete');
assert.equal(buildIndexingSummaryFromScanProfile(empty).totals.linesPerSec, 0);
const unknown = validate(buildScanProfile({ artifactReport: { repo: { indexDirs: { code: '/fixture/code' } } } }));
for (const key of ['chunks', 'tokens', 'lines', 'durationMs']) assert.equal(unknown.totals[key], null);
assert.equal(unknown.totals.files.candidates, null); assert.equal(unknown.totals.bytes.artifact, null);
assert.equal(unknown.coverage.counters.lines.state, 'unknown');
assert.equal(unknown.coverage.rates.linesPerSec.measuredSubsetPerSec, null);
const missingDuration = structuredClone(emptyInput); missingDuration.indexMetrics.code.timings = { totalMs: null, writeMs: null };
const noTime = validate(buildScanProfile(missingDuration));
assert.equal(noTime.totals.linesPerSec, null); assert.equal(noTime.modes.code.throughput.linesPerSec, null);
assert.equal(noTime.coverage.rates.linesPerSec.state, 'unknown');
const supplied = structuredClone(emptyInput); supplied.throughput.code = { filesPerSec: 0, linesPerSec: 200 };
assert.equal(validate(buildScanProfile(supplied)).modes.code.throughput.filesPerSec, 0, 'a measured supplied zero remains zero');

for (const suppliedRate of [null, undefined, false, '', '0', NaN, -1, 0, 999]) {
  const observed = structuredClone(emptyInput);
  observed.indexMetrics.code.files.candidates = 4;
  observed.throughput.code = { filesPerSec: suppliedRate };
  assert.equal(validate(buildScanProfile(observed)).modes.code.throughput.filesPerSec, 4);
}
const zeroTime = structuredClone(emptyInput); zeroTime.indexMetrics.code.timings.totalMs = 0;
assert.equal(validate(buildScanProfile(zeroTime)).totals.linesPerSec, null, 'zero elapsed time is not a measured rate');

const selectedOnly = input();
selectedOnly.artifactReport.health = { modes: { code: { selected: true }, prose: { selected: false },
  'extracted-prose': { selected: false }, records: { selected: false } } };
const selectedProfile = validate(buildScanProfile(selectedOnly));
assert.deepEqual(selectedProfile.coverage.requiredModes, ['code'], 'fallback paths and zero artifact sizes are not publication selection');
assert.equal(selectedProfile.totals.linesPerSec, 100);
assert.equal(selectedProfile.modes.prose.throughput.totalMs, null);
assert.equal(selectedProfile.modes.prose.bytes.artifact, null);

const precursor = buildObservedThroughput('code', { files: { candidates: null }, chunks: { total: 0 },
  tokens: { total: '0' }, timings: { totalMs: 1000, writeMs: null } }, null);
assert.equal(precursor.files, null); assert.equal(precursor.filesPerSec, null);
assert.equal(precursor.chunksPerSec, 0); assert.equal(precursor.tokensPerSec, null);
assert.equal(precursor.bytesPerSec, null); assert.equal(precursor.writeBytesPerSec, null);
const noCoverage = structuredClone(empty); delete noCoverage.coverage;
assert.equal(validateArtifact('scan_profile', noCoverage).ok, false);
assert.equal(buildIndexingSummaryFromScanProfile(noCoverage), null);
const legacy = structuredClone(empty); legacy.schemaVersion = 1; delete legacy.coverage;
validate(legacy);
assert.equal(buildIndexingSummaryFromScanProfile(legacy).coverage.sourceSchemaVersion, 1);
legacy.totals.files.candidates = null;
assert.equal(validateArtifact('scan_profile', legacy).ok, false, 'legacy required integer totals retain their contract');
const future = { ...empty, schemaVersion: 999 };
assert.equal(validateArtifact('scan_profile', future).ok, false);
assert.equal(buildIndexingSummaryFromScanProfile(future), null);
console.log('scan-profile matched observation scope test passed');
