import fs from 'node:fs/promises';
import path from 'node:path';
import { runWithConcurrency } from '../../src/shared/concurrency/run-with-queue.js';
import { loadTriageRecordSnapshot } from './record-snapshot.js';
import { describeStorageFailure, observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { redactDiagnosticText } from '../../src/shared/diagnostic-text.js';

export const TRIAGE_HISTORY_READ_CONCURRENCY = 4;
export const TRIAGE_HISTORY_DIAGNOSTIC_SAMPLES = 8;
export const readTriageHistoryRecord = async filePath => (
  await loadTriageRecordSnapshot(path.dirname(filePath), path.basename(filePath, '.json'))
).record;

/** Shared read admission; selection policies retain only their own bounded products.
 * Pending original work stops dispatch through the existing settled queue owner.
 */
export const scanTriageHistoryRecords = async ({ recordsDir, warnings, onRecord,
  readDirectory = directory => fs.readdir(directory, { withFileTypes: true }), readRecord = readTriageHistoryRecord }) => {
  let entries, directoryObservation;
  try {
    entries = await readDirectory(recordsDir);
    directoryObservation = observeStorageResource(entries, { phase: 'triage-history-scan-result' });
    directoryObservation.requireSettled();
  }
  catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'triage-history-scan', defaultCode: 'ERR_TRIAGE_HISTORY_SCAN' });
    warnings.push({ step: 'history-scan', code: diagnostic.code, error: redactDiagnosticText(diagnostic.message) });
    return { complete: false, failed: 0, reads: 0, names: [] };
  }
  // Stable directory identity is independent of completion order; callbacks may
  // retain one compact digest per admitted name without retaining corpus bodies.
  const files = [];
  try {
    if (!Array.isArray(entries)) throw new TypeError('History directory observation must contain ordinary entries.');
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (typeof name !== 'string' || name.includes('/') || name.includes('\\')) {
        throw new TypeError('History directory entries cannot select another path.');
      }
      if (path.extname(name) === '.json') files.push({ name });
    }
  } catch (inspection) { throw directoryObservation.retain(inspection, { inspectionPresent: true, inspectionPrimary: true }); }
  directoryObservation.requireSettled();
  let failed = 0;
  const samples = [];
  await runWithConcurrency(files, TRIAGE_HISTORY_READ_CONCURRENCY, async (entry, { index }) => {
    directoryObservation.requireSettled();
    let record, recordObservation;
    try {
      record = await readRecord(path.join(recordsDir, entry.name));
      recordObservation = observeStorageResource(record, { phase: 'triage-history-read-result' });
      recordObservation.requireSettled(); directoryObservation.requireSettled();
    } catch (error) {
      try { directoryObservation.requireSettled(); }
      catch { throw directoryObservation.retain(error, { inspectionPresent: true, inspectionPrimary: true }); }
      const diagnostic = describeStorageFailure(error, { phase: 'triage-history-read', defaultCode: 'ERR_TRIAGE_HISTORY_READ' });
      failed++;
      samples.push({ file: entry.name, code: diagnostic.code, error: redactDiagnosticText(diagnostic.message) });
      samples.sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
      if (samples.length > TRIAGE_HISTORY_DIAGNOSTIC_SAMPLES) samples.pop();
      return;
    }
    try { await onRecord(record, { name: entry.name, index }); }
    catch (error) {
      const retained = recordObservation.retain(error, { inspectionPresent: true, inspectionPrimary: true });
      throw directoryObservation.retain(retained, { inspectionPresent: true, inspectionPrimary: true });
    }
    recordObservation.requireSettled(); directoryObservation.requireSettled();
  }, { collectResults: false, retries: 0 });
  directoryObservation.requireSettled();
  if (failed) warnings.push({ step: 'history-read', error: 'History is incomplete because candidate reads failed.',
    failed, samples, omittedSamples: failed - samples.length });
  return { complete: failed === 0, failed, reads: files.length, names: files.map(entry => entry.name) };
};
