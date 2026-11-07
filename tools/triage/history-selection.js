import path from 'node:path';
import { createHash } from 'node:crypto';
import { getRecordPackages } from '../../src/integrations/triage/record-utils.js';
import { MinHeap } from '../../src/shared/min-heap.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { TRIAGE_HISTORY_SELECTION_VERSION, TRIAGE_HISTORY_SELECTION_POLICY, TRIAGE_HISTORY_LIMITS } from '../../src/contracts/triage-history.js';
import { assertTriageHistoryCursor, assertTriageHistorySelection } from '../../src/contracts/validators/triage-history.js';
import { scanTriageHistoryRecords } from './history-scan.js';
import { TRIAGE_RECORD_MAX_BYTES } from './record-snapshot.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code });
const text = value => typeof value === 'string' && value.length <= 4096 ? value : null;
const equal = (a, b) => Boolean(text(a)?.trim() && text(b)?.trim() && a.trim() === b.trim());
const key = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const compareExact = (a, b) => b.timestamp - a.timestamp || compareId(a.id, b.id);
const compareRelated = (a, b) => Number(b.routeMatch) - Number(a.routeMatch) || b.score - a.score || compareExact(a, b);
const observation = value => value?.schemaVersion === 1 && value.recordType === 'finding'
  && typeof value.recordId === 'string' && typeof value.source === 'string' && value.hashAlgorithm === 'sha256'
  && typeof value.hash === 'string' && /^[a-f0-9]{64}$/u.test(value.hash)
  && Number.isSafeInteger(value.bytes) && value.bytes > 0 ? value : null;

const candidateMeta = (record, finding, recordId, repoRoot, currentObservation, asOf) => {
  const fields = [], findingLink = text(record.decision?.findingRecordId) || null;
  const original = observation(record.decision?.findingObservation), current = observation(currentObservation);
  const repository = text(record.repo), targetRepository = text(finding.repo) || repoRoot;
  const repositoryMismatch = repository && (path.isAbsolute(repository) && path.isAbsolute(targetRepository)
    ? key(repository) !== key(targetRepository) : repository !== targetRepository);
  const observationMismatch = original && (original.recordId !== recordId || original.source !== finding.source);
  const exact = findingLink === recordId && !repositoryMismatch && !observationMismatch;
  if (findingLink === recordId) fields.push('findingRecordId');
  if (equal(record.vuln?.cve || record.vuln?.vulnId, finding.vuln?.cve || finding.vuln?.vulnId)) fields.push('vulnerability');
  const packages = getRecordPackages(record), wanted = getRecordPackages(finding);
  if (wanted.some(a => packages.some(b => equal(a.name, b.name)))) fields.push('packageName');
  if (wanted.some(a => text(a.manifestPath) && packages.some(b => text(b.manifestPath)
    && equal(path.basename(a.manifestPath), path.basename(b.manifestPath))))) fields.push('manifestBasename');
  if (equal(record.service, finding.service)) fields.push('service');
  if (equal(record.env, finding.env)) fields.push('env');
  if (!fields.length) return null;
  const weights = { findingRecordId: 8, vulnerability: 4, packageName: 3, manifestBasename: 2, service: 1, env: 1 };
  const routeFields = ['service', 'env'].filter(field => text(finding[field])?.trim());
  const routeMatch = routeFields.length > 0 && routeFields.every(field => equal(record[field], finding[field]));
  const expiry = record.decision?.expiresAt;
  const expires = typeof expiry === 'string' ? Date.parse(expiry) : NaN;
  const recorded = Date.parse(record.updatedAt || record.createdAt || '');
  return { relation: exact ? 'exactFinding' : 'relatedPrecedent', sourceDecisionId: record.recordId,
    findingRecordId: findingLink, matchedFields: fields, score: fields.reduce((sum, field) => sum + weights[field], 0), routeMatch,
    scope: repositoryMismatch ? 'different-repository' : observationMismatch ? 'different-finding-observation' : 'selected-record-namespace',
    observation: { state: !original || !current ? 'unknown' : observationMismatch ? 'identity-mismatch'
      : original.hash === current.hash ? 'same' : 'changed',
    originalHash: original?.hash || null, currentHash: current?.hash || null,
    route: !routeFields.length ? 'unknown' : routeMatch ? 'same' : 'changed' },
    validity: { asOf, expiry: expiry == null || expiry === '' ? 'absent' : !Number.isFinite(expires) ? 'invalid'
      : expires <= Date.parse(asOf) ? 'expired' : 'not-expired',
    recorded: !Number.isFinite(recorded) ? 'unknown' : recorded > Date.parse(asOf) ? 'after-as-of' : 'at-or-before-as-of',
    interpretation: 'historical-only;not-approval-or-suppression', supersession: 'unverified' } };
};

const boundedLane = (limit, compare) => {
  const heap = new MinHeap((a, b) => -compare(a, b)); let bytes = 0;
  return { offer(candidate) {
    if (candidate.bytes > TRIAGE_HISTORY_LIMITS.outputBytes - TRIAGE_HISTORY_LIMITS.metadataReserveBytes) return false;
    heap.push(candidate); bytes += candidate.bytes;
    while (heap.size > limit || bytes > TRIAGE_HISTORY_LIMITS.outputBytes) bytes -= heap.pop().bytes;
    return true;
  }, ordered: () => [...heap.items].sort(compare), size: () => heap.size, bytes: () => bytes };
};

/** One scan, four admitted reads, bounded exact/route/relaxed retained lanes.
 * Continuation reobserves the same selected namespace and refuses any changed
 * content/name/policy/finding identity; it never authorizes another source path.
 */
export const buildTriageHistorySelection = async ({ recordsDir, repoRoot, recordId, finding, findingObservation = null,
  maxHistory = 5, warnings = [], cursor = null, asOf = null, readDirectory, readRecord } = {}) => {
  if (!path.isAbsolute(recordsDir || '') || !path.isAbsolute(repoRoot || '') || typeof recordId !== 'string'
    || !recordId || recordId.length > 4096 || finding?.recordId !== recordId || finding.recordType !== 'finding'
    || !text(finding.source)) throw new TypeError('History requires its selected repository, record namespace and finding.');
  if (cursor !== null) cursor = assertTriageHistoryCursor(cursor);
  asOf ??= cursor?.asOf || new Date().toISOString();
  if (typeof asOf !== 'string' || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString() !== asOf) throw new TypeError('History requires a canonical as-of time.');
  const requested = Math.max(0, Math.floor(Number(maxHistory)));
  if (!Number.isSafeInteger(requested)) throw new TypeError('History requires a finite safe integer result budget.');
  const findingJson = JSON.stringify(finding);
  if (Buffer.byteLength(findingJson) > TRIAGE_RECORD_MAX_BYTES) throw new TypeError('Selected finding exceeds its existing record allowance.');
  finding = JSON.parse(findingJson);
  const current = observation(findingObservation);
  if (current && (current.recordId !== recordId || current.source !== finding.source)) {
    throw fail('ERR_TRIAGE_HISTORY_IDENTITY', 'Finding observation differs from the selected finding identity.');
  }
  findingObservation = current ? Object.freeze(Object.fromEntries(['schemaVersion', 'recordId', 'recordType', 'source',
    'hashAlgorithm', 'hash', 'bytes'].map(field => [field, current[field]]))) : null;
  const limit = Math.min(requested, TRIAGE_HISTORY_LIMITS.records), reserved = cursor ? limit : Math.ceil(limit / 2);
  const scopeHash = sha(stableStringify({ policy: TRIAGE_HISTORY_SELECTION_POLICY, records: key(recordsDir), repo: key(repoRoot),
    recordId, finding, findingObservation, asOf, limit, limits: TRIAGE_HISTORY_LIMITS }));
  if (cursor && cursor.scopeHash !== scopeHash) throw fail('ERR_TRIAGE_HISTORY_CURSOR_STALE', 'History continuation differs from its selected finding, namespace, policy or budget.');
  const exact = boundedLane(limit, compareExact), route = boundedLane(limit, compareRelated), relaxed = boundedLane(limit, compareRelated);
  const hashes = [], candidates = { exact: 0, related: 0 }, oversized = { exact: 0, related: 0 };
  let priorExact = 0, cursorBoundaryObserved = !cursor;
  const scan = limit ? await scanTriageHistoryRecords({ recordsDir, warnings, readDirectory, readRecord,
    onRecord: (record, { name, index }) => {
      // The actual snapshot reader bounds each input at 16 MiB. Retain only the
      // compact wire body for selected candidates, never an additional AST/tree.
      const recordJson = JSON.stringify(record);
      hashes[index] = sha(stableStringify([name, sha(recordJson)]));
      if (record?.recordType !== 'decision' || record.recordId === recordId) return;
      if (!text(record.recordId)) throw fail('ERR_TRIAGE_HISTORY_IDENTITY', 'History decision has no bounded stable identity.');
      const meta = candidateMeta(record, finding, recordId, repoRoot, findingObservation, asOf);
      if (!meta) return;
      const timestamp = Date.parse(record.updatedAt || record.createdAt || ''), candidate = { id: record.recordId,
        timestamp: Number.isFinite(timestamp) ? timestamp : 0, ordinal: index, meta, recordJson,
        score: meta.score, routeMatch: meta.routeMatch,
        bytes: Buffer.byteLength(recordJson) + Buffer.byteLength(JSON.stringify(meta)) + 2 };
      const kind = meta.relation === 'exactFinding' ? 'exact' : 'related';
      if (cursor && kind === 'exact' && candidate.id === cursor.after.decisionId
        && candidate.timestamp === cursor.after.timestamp) cursorBoundaryObserved = true;
      if (candidate.bytes > TRIAGE_HISTORY_LIMITS.outputBytes - TRIAGE_HISTORY_LIMITS.metadataReserveBytes) {
        candidates[kind]++; oversized[kind]++; return;
      }
      if (kind === 'exact' && cursor && compareExact(candidate, { id: cursor.after.decisionId,
        timestamp: cursor.after.timestamp }) <= 0) { priorExact++; return; }
      candidates[kind]++;
      if (cursor && kind !== 'exact') return;
      const lane = kind === 'exact' ? exact : meta.routeMatch ? route : relaxed;
      if (!lane.offer(candidate)) oversized[kind]++;
    }
  }) : { complete: false, failed: 0, reads: 0, names: [] };
  const snapshotHash = limit && scan.complete ? sha(stableStringify(scan.names.map((name, index) => [name, hashes[index]])
    .sort((a, b) => compareId(a[0], b[0])))) : null;
  if (cursor && (!scan.complete || snapshotHash !== cursor.snapshotHash || !cursorBoundaryObserved)) {
    throw fail('ERR_TRIAGE_HISTORY_CURSOR_STALE', 'History continuation cannot reuse a changed/incomplete observation or unknown boundary.');
  }
  const allExact = exact.ordered(), allRelated = [...route.ordered(), ...relaxed.ordered()];
  const selected = [], used = new Set(); let selectedBytes = TRIAGE_HISTORY_LIMITS.metadataReserveBytes;
  const select = (items, count, prefix = false) => {
    let accepted = 0;
    for (const item of items) {
      if (accepted >= count || selected.length >= limit) break;
      if (used.has(item)) continue;
      if (selectedBytes + item.bytes > TRIAGE_HISTORY_LIMITS.outputBytes) { if (prefix) break; continue; }
      used.add(item); selected.push(item); selectedBytes += item.bytes; accepted++;
    }
  };
  select(allExact, reserved, true); if (!cursor) select(allRelated, limit - selected.length);
  select(allExact, limit - selected.length, true);
  const selectedExact = selected.filter(item => item.meta.relation === 'exactFinding'), last = selectedExact.at(-1);
  const omitted = { exact: candidates.exact - selectedExact.length, related: candidates.related - (selected.length - selectedExact.length) };
  const next = scan.complete && last && omitted.exact > oversized.exact ? assertTriageHistoryCursor({
    schemaVersion: TRIAGE_HISTORY_SELECTION_VERSION, policy: TRIAGE_HISTORY_SELECTION_POLICY, scopeHash, snapshotHash, asOf,
    after: { timestamp: last.timestamp, decisionId: last.id }
  }) : null;
  const historySelection = { schemaVersion: TRIAGE_HISTORY_SELECTION_VERSION, policy: TRIAGE_HISTORY_SELECTION_POLICY,
    asOf, scopeHash, snapshotHash, mode: cursor ? 'exact-continuation' : 'initial',
    allocation: { requested, limit, exactReserved: reserved, outputBytesMax: TRIAGE_HISTORY_LIMITS.outputBytes,
      retainedCandidatesMax: 3 * limit, retainedCandidateBytesMax: 3 * TRIAGE_HISTORY_LIMITS.outputBytes },
    coverage: { state: !limit ? 'disabled' : !scan.complete || omitted.exact || omitted.related ? 'partial' : 'complete',
      reads: scan.reads, readFailures: scan.failed, countsAreLowerBounds: !scan.complete,
      candidates, omitted, oversized, earlierExactPassed: priorExact },
    items: selected.map(item => item.meta), continuation: next,
    continuationState: !limit ? 'disabled' : !scan.complete ? 'unavailable-incomplete-observation' : next ? 'available'
      : omitted.exact ? 'unavailable-record-byte-budget' : 'exact-history-exhausted',
    accounting: 'compact-json-history-plus-selection;not-process-heap', outputBytes: 0 };
  const result = { history: selected.map(item => JSON.parse(item.recordJson)), historySelection };
  for (let turn = 0; turn < 5; turn++) {
    const measured = Buffer.byteLength(JSON.stringify(result));
    if (measured === historySelection.outputBytes) break;
    historySelection.outputBytes = measured;
  }
  if (historySelection.outputBytes !== Buffer.byteLength(JSON.stringify(result)) || historySelection.outputBytes > TRIAGE_HISTORY_LIMITS.outputBytes) {
    throw fail('ERR_TRIAGE_HISTORY_BUDGET', 'History projection exceeded its admitted output budget.');
  }
  assertTriageHistorySelection(historySelection);
  return result;
};
