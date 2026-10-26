import { isSupportedScanProfileVersion } from '../../../../src/contracts/scan-profile.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { TextDecoder } from 'node:util';
import { readVerifiedContainedFileSync } from '../../../../src/shared/contained-file.js';
import { observeStorageResource } from '../../../../src/shared/storage/failure-observation.js';
import { stableStringifyForSignature } from '../../../../src/shared/stable-json.js';

import { BENCH_MEASUREMENT_DERIVATION_VERSION, BENCH_MEASUREMENT_SNAPSHOT_VERSION } from './recorded-contract.js';
export { BENCH_MEASUREMENT_DERIVATION_VERSION, BENCH_MEASUREMENT_SNAPSHOT_VERSION };
const MODES = ['code', 'prose', 'extracted-prose', 'records'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const digest = value => crypto.createHash('sha256').update(stableStringifyForSignature(value)).digest('hex');
const referenceFailure = message => Object.assign(new Error(message), { code: 'ERR_BENCH_MEASUREMENT_REFERENCE' });
const hasModeObservation = value => object(value) && [value.files?.candidates, value.chunks?.total, value.tokens?.total,
  value.bytes?.source, value.bytes?.total, value.timings?.totalMs, value.timings?.writeMs,
  value.timings?.discoverMs, value.timings?.importsMs, value.timings?.scmMetaMs,
  ...Object.values(value.timings?.stageTimingBreakdown || {}).map(section => section?.totalMs)]
  .some(number => typeof number === 'number' && Number.isFinite(number) && number >= 0);

/** Only an exact attempt/hash/extent reference relative to the actually read
 * report's directory authorizes external historical observations. Repo paths,
 * current pointers, config and file stamps never supply that identity. */
const readSnapshot = (reference, sourceRoot, attemptId) => {
  if (!reference) return { value: null, receipt: { state: 'absent' } };
  try {
    if (!sourceRoot || !path.isAbsolute(sourceRoot) || reference.schemaVersion !== BENCH_MEASUREMENT_SNAPSHOT_VERSION
      || typeof reference.attemptId !== 'string' || reference.attemptId !== attemptId || !/^[a-zA-Z0-9_-]{1,160}$/u.test(reference.attemptId)
      || typeof reference.path !== 'string' || reference.path.length > 1024 || reference.path.includes('\\')
      || path.posix.isAbsolute(reference.path) || path.win32.isAbsolute(reference.path)
      || reference.path !== path.posix.normalize(reference.path) || reference.path === '.'
      || reference.path === '..' || reference.path.startsWith('../')
      || !Number.isSafeInteger(reference.bytes) || reference.bytes < 1 || reference.bytes > 8 * 1024 * 1024
      || typeof reference.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(reference.sha256)) {
      throw referenceFailure('Recorded measurement reference lacks exact bounded source authority.');
    }
    const read = readVerifiedContainedFileSync(sourceRoot, path.resolve(sourceRoot, reference.path), {
      maxBytes: 8 * 1024 * 1024, expectedBytes: reference.bytes, expectedHash: reference.sha256
    });
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.buffer));
    if (!object(value) || value.schemaVersion !== BENCH_MEASUREMENT_SNAPSHOT_VERSION || value.attemptId !== reference.attemptId
      || !(object(value.metricsByMode) || object(value.featureMetrics))) throw referenceFailure('Recorded measurement attempt or envelope does not match.');
    return { value, receipt: { state: 'qualified-attempt-snapshot', attemptId: value.attemptId,
      path: reference.path, bytes: read.buffer.length, sha256: read.hash } };
  } catch (error) {
    observeStorageResource(error, { phase: 'benchmark-recorded-measurements' }).requireSettled();
    return { value: null, receipt: { state: 'unavailable', reason: typeof error.code === 'string' ? error.code : 'ERR_BENCH_MEASUREMENT_PARSE' } };
  }
};

export const resolveRecordedMeasurementInputs = ({ payload, sourceRoot = null } = {}) => {
  const scanProfile = payload?.artifacts?.scanProfile;
  const embeddedModes = isSupportedScanProfileVersion(scanProfile?.schemaVersion) && object(scanProfile.modes) ? scanProfile.modes : null;
  const attemptId = typeof payload?.run?.attemptId === 'string' ? payload.run.attemptId : null;
  const snapshot = readSnapshot(payload?.artifacts?.measurementSnapshot, sourceRoot, attemptId);
  const metricsByMode = {}, modeSources = {};
  for (const mode of MODES) {
    if (hasModeObservation(embeddedModes?.[mode])) {
      metricsByMode[mode] = embeddedModes[mode]; modeSources[mode] = 'embedded-scan-profile';
    } else if (hasModeObservation(snapshot.value?.metricsByMode?.[mode])) {
      metricsByMode[mode] = snapshot.value.metricsByMode[mode]; modeSources[mode] = 'qualified-attempt-snapshot';
    }
  }
  const observation = { summary: payload?.summary || payload?.runs?.[0] || null,
    throughput: payload?.artifacts?.throughput || null,
    indexing: payload?.artifacts?.indexing?.derivation || payload?.artifacts?.materialization?.sections?.indexing
      ? null : payload?.artifacts?.indexing?.modes || null,
    scanProfile: scanProfile || null, snapshot: snapshot.receipt };
  return { metricsByMode, featureMetrics: snapshot.value?.featureMetrics || null,
    receipt: { derivationVersion: BENCH_MEASUREMENT_DERIVATION_VERSION,
      scope: 'recorded-report-observations', sourceDigest: 'sha256:' + digest(observation),
      attemptId,
      recordedAt: typeof payload?.generatedAt === 'string' ? payload.generatedAt : null,
      embeddedScanProfile: Boolean(embeddedModes), modeSources, external: snapshot.receipt } };
};

export const recordedLedgerProvenance = (ledger, previous) => {
  const derived = Boolean(ledger?.derivation);
  const materialized = previous?.category === 'fallback' || previous?.source === 'fallback-throughput-derived';
  return { section: 'throughput-ledger', source: derived || materialized ? 'fallback-throughput-derived' : 'native-throughput-ledger',
    category: derived || materialized ? 'fallback' : 'native',
    ...(derived ? { derivation: ledger.derivation } : materialized ? { derivation: { state: 'legacy-materialized-source-unqualified' } } : {}) };
};

export const canReuseRecordedLedger = (ledger, previous, { preferExisting = true } = {}) => (
  recordedLedgerProvenance(ledger, previous).category === 'native'
  || preferExisting && ledger?.derivation?.derivationVersion === BENCH_MEASUREMENT_DERIVATION_VERSION
);
