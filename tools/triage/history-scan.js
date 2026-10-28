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
  let entries;
  try { entries = await readDirectory(recordsDir); }
  catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'triage-history-scan', defaultCode: 'ERR_TRIAGE_HISTORY_SCAN' });
    warnings.push({ step: 'history-scan', code: diagnostic.code, error: redactDiagnosticText(diagnostic.message) });
    return { complete: false, failed: 0, reads: 0, names: [] };
  }
  // Stable directory identity is independent of completion order; callbacks may
  // retain one compact digest per admitted name without retaining corpus bodies.
  const files = entries.filter(entry => entry.isFile() && path.extname(entry.name) === '.json');
  let failed = 0;
  const samples = [];
  await runWithConcurrency(files, TRIAGE_HISTORY_READ_CONCURRENCY, async (entry, { index }) => {
    let record;
    try {
      record = await readRecord(path.join(recordsDir, entry.name));
      observeStorageResource(record, { phase: 'triage-history-read-result' }).requireSettled();
    } catch (error) {
      const diagnostic = describeStorageFailure(error, { phase: 'triage-history-read', defaultCode: 'ERR_TRIAGE_HISTORY_READ' });
      failed++;
      samples.push({ file: entry.name, code: diagnostic.code, error: redactDiagnosticText(diagnostic.message) });
      samples.sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
      if (samples.length > TRIAGE_HISTORY_DIAGNOSTIC_SAMPLES) samples.pop();
      return;
    }
    await onRecord(record, { name: entry.name, index });
  }, { collectResults: false, retries: 0 });
  if (failed) warnings.push({ step: 'history-read', error: 'History is incomplete because candidate reads failed.',
    failed, samples, omittedSamples: failed - samples.length });
  return { complete: failed === 0, failed, reads: files.length, names: files.map(entry => entry.name) };
};
