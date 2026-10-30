import path from 'node:path';
import { getRecordPackages } from '../../src/integrations/triage/record-utils.js';
import { MinHeap } from '../../src/shared/min-heap.js';
import { scanTriageHistoryRecords } from './history-scan.js';
export { TRIAGE_HISTORY_READ_CONCURRENCY, TRIAGE_HISTORY_DIAGNOSTIC_SAMPLES, readTriageHistoryRecord } from './history-scan.js';

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
  readDirectory, readRecord }) => {
  const limit = Math.max(0, Math.floor(Number(maxHistory)));
  if (!Number.isSafeInteger(limit)) throw new TypeError('Triage history requires a finite safe integer result budget.');
  if (!limit) return [];
  const routeScoped = new MinHeap((left, right) => -compareCandidate(left, right));
  const relaxed = new MinHeap((left, right) => -compareCandidate(left, right));
  await scanTriageHistoryRecords({ recordsDir, warnings, readDirectory, readRecord, onRecord: (record, { index }) => {
    if (!record || record.recordType !== 'decision' || record.recordId === recordId) return;
    const candidate = scoreCandidate(record, finding, recordId, index);
    if (!candidate) return;
    const heap = candidate.routeMatch ? routeScoped : relaxed;
    heap.push(candidate);
    if (heap.size > limit) heap.pop();
  } });
  return [...routeScoped.items.sort(compareCandidate), ...relaxed.items.sort(compareCandidate)]
    .slice(0, limit).map(candidate => candidate.record);
};
