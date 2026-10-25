import fs from 'node:fs/promises';
import path from 'node:path';
import { getRecordPackages } from '../../src/integrations/triage/record-utils.js';
import { runWithConcurrency } from '../../src/shared/concurrency/run-with-queue.js';
import { MinHeap } from '../../src/shared/min-heap.js';
import { loadTriageRecordSnapshot } from './record-snapshot.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';
import { redactDiagnosticText } from '../../src/shared/diagnostic-text.js';

export const TRIAGE_HISTORY_READ_CONCURRENCY = 4;
export const TRIAGE_HISTORY_DIAGNOSTIC_SAMPLES = 8;

export const readTriageHistoryRecord = async filePath => {
  return (await loadTriageRecordSnapshot(path.dirname(filePath), path.basename(filePath, '.json'))).record;
};

const valuesEqual = (left, right) => Boolean(left && right && String(left).trim() === String(right).trim());
const matchesRoute = (record, finding) => {
  let constrained = false;
  for (const key of ['service', 'env']) {
    if (!finding?.[key]) continue;
    constrained = true;
    if (!valuesEqual(record?.[key], finding[key])) return false;
  }
  return constrained;
};
const scoreCandidate = (record, finding, recordId, ordinal) => {
  let score = 0;
  const vulnId = finding?.vuln?.cve || finding?.vuln?.vulnId;
  const targetVuln = record?.vuln?.cve || record?.vuln?.vulnId;
  if (record?.decision?.findingRecordId && record.decision.findingRecordId === recordId) score += 8;
  if (vulnId && valuesEqual(targetVuln, vulnId)) score += 4;
  if (getRecordPackages(finding).some(left => getRecordPackages(record).some(right => valuesEqual(left.name, right.name)))) score += 3;
  if (getRecordPackages(finding).some(left => left.manifestPath && getRecordPackages(record).some(right => right.manifestPath
    && valuesEqual(path.basename(left.manifestPath), path.basename(right.manifestPath))))) score += 2;
  if (valuesEqual(record?.service, finding?.service)) score += 1;
  if (valuesEqual(record?.env, finding?.env)) score += 1;
  if (!score) return null;
  const parsed = Date.parse(record?.updatedAt || record?.createdAt || '');
  return { record, score, routeMatch: matchesRoute(record, finding), timestamp: Number.isFinite(parsed) ? parsed : 0, ordinal };
};
const compareCandidate = (left, right) => (right.score - left.score) || (right.timestamp - left.timestamp)
  || String(left.record?.recordId || '').localeCompare(String(right.record?.recordId || ''))
  // The previous full stable sort retained directory order for exact ties.
  || left.ordinal - right.ordinal;

/** Retain at most K candidates per route class while existing queue admission
 * bounds reads. Directory names/queue bookkeeping remain proportional to N;
 * full record retention is bounded by 2K plus admitted reads, not corpus size.
 * Dependency arguments are internal adapters, not CLI/configuration knobs.
 */
export const buildTriageHistory = async ({ recordsDir, recordId, finding, maxHistory = 5, warnings,
  readDirectory = directory => fs.readdir(directory, { withFileTypes: true }), readRecord = readTriageHistoryRecord }) => {
  const limit = Math.max(0, Math.floor(Number(maxHistory)));
  if (!Number.isSafeInteger(limit)) throw new TypeError('Triage history requires a finite safe integer result budget.');
  if (!limit) return [];
  let entries;
  try { entries = await readDirectory(recordsDir); }
  catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'triage-history-scan', defaultCode: 'ERR_TRIAGE_HISTORY_SCAN' });
    warnings.push({ step: 'history-scan', code: diagnostic.code, error: redactDiagnosticText(diagnostic.message) });
    return [];
  }
  const routeScoped = new MinHeap((left, right) => -compareCandidate(left, right));
  const relaxed = new MinHeap((left, right) => -compareCandidate(left, right));
  let failed = 0;
  const samples = [];
  await runWithConcurrency(entries, TRIAGE_HISTORY_READ_CONCURRENCY, async (entry, { index }) => {
    if (!entry.isFile() || path.extname(entry.name) !== '.json') return;
    let record;
    try { record = await readRecord(path.join(recordsDir, entry.name)); }
    catch (error) {
      // A warning cannot authorize another reader around retained native work.
      const diagnostic = describeStorageFailure(error, { phase: 'triage-history-read', defaultCode: 'ERR_TRIAGE_HISTORY_READ' });
      failed++;
      samples.push({ file: entry.name, code: diagnostic.code, error: redactDiagnosticText(diagnostic.message) });
      samples.sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
      if (samples.length > TRIAGE_HISTORY_DIAGNOSTIC_SAMPLES) samples.pop();
      return;
    }
    if (!record || record.recordType !== 'decision' || record.recordId === recordId) return;
    const candidate = scoreCandidate(record, finding, recordId, index);
    if (!candidate) return;
    const heap = candidate.routeMatch ? routeScoped : relaxed;
    heap.push(candidate);
    if (heap.size > limit) heap.pop();
  }, { collectResults: false, retries: 0 });
  if (failed) warnings.push({ step: 'history-read', error: 'History is incomplete because candidate reads failed.',
    failed, samples, omittedSamples: failed - samples.length });
  return [...routeScoped.items.sort(compareCandidate), ...relaxed.items.sort(compareCandidate)]
    .slice(0, limit).map(candidate => candidate.record);
};
