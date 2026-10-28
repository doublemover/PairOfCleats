import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildTriageHistorySelection } from '../../../tools/triage/history-selection.js';
import { TRIAGE_HISTORY_LIMITS } from '../../../src/contracts/triage-history.js';
import { assertTriageHistoryCursor, parseTriageHistoryCursor } from '../../../src/contracts/validators/triage-history.js';
import { writeTriageRecordArtifacts } from '../../../tools/triage/record-writer.js';
import { loadTriageRecordSnapshot } from '../../../tools/triage/record-snapshot.js';
import { readTriagePublication, TRIAGE_PUBLICATION_FIELD } from '../../../src/integrations/triage/record-publication.js';
import { renderRecordMarkdown } from '../../../src/integrations/triage/render.js';
import { prepareIsolatedTestCacheDir, resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { MinHeap } from '../../../src/shared/min-heap.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

// UNVALIDATED: actual scan/queue/heaps/snapshot/publication; no index or model.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const cases = ['exact-route-drift', 'similarity-is-not-lineage', 'historical-facts', 'byte-budget', 'count-and-read-bounds',
  'disabled', 'read-failure', 'pending-error', 'pending-result', 'continuation', 'stale-continuation', 'scope-continuation',
  'cursor-negatives', 'persisted', 'legacy-renderer'];
assert.ok(cases.includes(selected));
const asOf = '2026-10-27T12:00:00.000Z';
const repoRoot = path.resolve('.tmp', 'lineage-selected-repository'), recordsDir = path.resolve('.tmp', 'lineage-selected-records');
const finding = { recordId: 'finding-a', recordType: 'finding', source: 'generic', service: 'api', env: 'prod',
  vuln: { cve: 'CVE-TARGET' }, package: { name: 'target', manifestPath: 'src/package.json' } };
const observation = { schemaVersion: 1, recordId: finding.recordId, recordType: 'finding', source: 'generic',
  hashAlgorithm: 'sha256', hash: 'a'.repeat(64), bytes: 100 };
const decision = (id, exact = true, extra = {}) => ({ recordId: id, recordType: 'decision', source: 'manual', repo: repoRoot,
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
  decision: { findingRecordId: exact ? finding.recordId : 'other-finding', status: 'accept', reviewer: 'reviewer-a' }, ...extra });
const input = { recordsDir, repoRoot, recordId: finding.recordId, finding, findingObservation: observation, asOf, warnings: [] };
const select = async (records, options = {}) => {
  let active = 0, peak = 0, reads = 0;
  const { readRecord: customRead, ...rest } = options;
  const output = await buildTriageHistorySelection({ ...input, warnings: [],
    readDirectory: async () => records.map(record => ({ name: record.recordId + '.json', isFile: () => true })),
    ...rest,
    readRecord: async file => {
      reads++; active++; peak = Math.max(peak, active);
      try {
        await new Promise(resolve => setImmediate(resolve));
        return customRead ? await customRead(file) : records.find(record => path.basename(file) === record.recordId + '.json');
      }
      finally { active--; }
    } });
  assert.equal(active, 0); assert.ok(peak <= 4); assert.equal(reads, records.length);
  assert.equal(Buffer.byteLength(JSON.stringify(output)), output.historySelection.outputBytes);
  assert.ok(output.historySelection.outputBytes <= TRIAGE_HISTORY_LIMITS.outputBytes);
  return output;
};
const ids = output => output.history.map(record => record.recordId);
const related = Array.from({ length: 5 }, (_, index) => decision('related-' + index, false, { service: 'api', env: 'prod',
  vuln: finding.vuln, package: finding.package }));
let fixtureRoot, workError;
try {
  if (selected === 'exact-route-drift') {
    const exact = decision('exact-old-route', true, { service: 'api', env: 'staging' });
    const output = await select([exact, ...related]);
    assert.deepEqual(ids(output), ['exact-old-route', 'related-0', 'related-1', 'related-2', 'related-3']);
    assert.equal(output.historySelection.items[0].relation, 'exactFinding');
    assert.equal(output.historySelection.items[0].observation.route, 'changed');
    assert.equal(output.historySelection.items.slice(1).every(item => item.relation === 'relatedPrecedent'), true);
  } else if (selected === 'similarity-is-not-lineage') {
    const output = await select([...related, decision('other-repo', true, { repo: path.join(repoRoot, 'different') }),
      decision('other-observation', true, { decision: { findingRecordId: finding.recordId,
        findingObservation: { ...observation, source: 'different-source' } } })], { maxHistory: 10 });
    assert.equal(output.historySelection.items.every(item => item.relation === 'relatedPrecedent'), true);
    assert.equal(output.historySelection.items.some(item => item.scope === 'different-repository'), true);
    assert.equal(output.historySelection.items.some(item => item.scope === 'different-finding-observation'), true);
  } else if (selected === 'historical-facts') {
    const records = [decision('accepted'), decision('conflicting', true, { updatedAt: '2026-10-22T00:00:00.000Z',
      decision: { findingRecordId: finding.recordId, status: 'fix', reviewer: 'reviewer-b', expiresAt: '2026-10-26T00:00:00.000Z',
        findingObservation: { ...observation, hash: 'b'.repeat(64) } } }),
    decision('future', true, { updatedAt: '2026-10-28T00:00:00.000Z' })];
    const output = await select(records);
    assert.deepEqual(ids(output), ['future', 'conflicting', 'accepted']);
    assert.deepEqual(output.history.map(row => row.decision.status), ['accept', 'fix', 'accept']);
    assert.equal(output.historySelection.items[0].validity.recorded, 'after-as-of');
    assert.equal(output.historySelection.items[1].validity.expiry, 'expired');
    assert.equal(output.historySelection.items[1].observation.state, 'changed');
    assert.equal(output.historySelection.items[2].observation.state, 'unknown');
    assert.equal(output.historySelection.items.every(item => item.validity.interpretation.includes('not-approval-or-suppression')), true);
  } else if (selected === 'byte-budget') {
    const output = await select([decision('too-large', true, { raw: '界'.repeat(TRIAGE_HISTORY_LIMITS.outputBytes / 2) }),
      decision('kept'), ...related], { maxHistory: 100 });
    assert.equal(ids(output).includes('too-large'), false); assert.equal(ids(output).includes('kept'), true);
    assert.equal(output.historySelection.coverage.oversized.exact, 1);
    assert.equal(output.historySelection.coverage.state, 'partial');
    assert.equal(output.historySelection.continuation, null);
    assert.equal(output.historySelection.continuationState, 'unavailable-record-byte-budget');
  } else if (selected === 'count-and-read-bounds') {
    const records = Array.from({ length: 1024 }, (_, index) => decision('d-' + String(index).padStart(4, '0')));
    const originalPush = MinHeap.prototype.push, peaks = new Map();
    let output;
    try {
      MinHeap.prototype.push = function (candidate) {
        const value = originalPush.call(this, candidate), previous = peaks.get(this) || { entries: 0, bytes: 0 };
        peaks.set(this, { entries: Math.max(previous.entries, this.size),
          bytes: Math.max(previous.bytes, this.items.reduce((sum, item) => sum + item.bytes, 0)) });
        return value;
      };
      output = await select(records, { maxHistory: 10000 });
    } finally { MinHeap.prototype.push = originalPush; }
    assert.equal(peaks.size, 1, 'only the exact lane admits this independently authored corpus');
    for (const [heap, peak] of peaks) {
      assert.ok(peak.entries <= TRIAGE_HISTORY_LIMITS.records + 1);
      assert.ok(peak.bytes <= 2 * TRIAGE_HISTORY_LIMITS.outputBytes, 'one transient insertion precedes eviction');
      assert.ok(heap.size <= TRIAGE_HISTORY_LIMITS.records);
      assert.ok(heap.items.reduce((sum, item) => sum + item.bytes, 0) <= TRIAGE_HISTORY_LIMITS.outputBytes);
    }
    assert.equal(output.history.length, TRIAGE_HISTORY_LIMITS.records);
    assert.equal(output.historySelection.coverage.candidates.exact, 1024);
    assert.equal(output.historySelection.coverage.omitted.exact, 1024 - TRIAGE_HISTORY_LIMITS.records);
    assert.equal(output.historySelection.allocation.retainedCandidatesMax, 3 * TRIAGE_HISTORY_LIMITS.records);
    assert.ok(output.historySelection.continuation);
  } else if (selected === 'disabled') {
    const output = await buildTriageHistorySelection({ ...input, maxHistory: 0,
      readDirectory() { assert.fail('disabled history cannot scan'); }, readRecord() { assert.fail('disabled history cannot read'); } });
    assert.deepEqual(output.history, []); assert.equal(output.historySelection.coverage.state, 'disabled');
    assert.equal(output.historySelection.coverage.countsAreLowerBounds, true);
  } else if (selected === 'read-failure') {
    const warnings = [];
    const output = await select([decision('good'), decision('bad')], { warnings,
      readRecord: async file => { if (path.basename(file) === 'bad.json') throw Object.assign(new Error('denied'), { code: 'EACCES' }); return decision('good'); } });
    assert.deepEqual(ids(output), ['good']); assert.equal(output.historySelection.coverage.countsAreLowerBounds, true);
    assert.equal(output.historySelection.coverage.readFailures, 1); assert.equal(output.historySelection.continuation, null);
    assert.equal(warnings[0].failed, 1);
  } else if (selected === 'pending-error' || selected === 'pending-result') {
    let settled = false, calls = 0;
    const original = Object.freeze(Object.assign(selected === 'pending-result' ? decision('pending') : new Error('pending source read'), {
      cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, original); return settled; }
    }));
    const error = await buildTriageHistorySelection({ ...input,
      readDirectory: async () => [{ name: 'pending.json', isFile: () => true }], readRecord: async () => {
        calls++; if (selected === 'pending-error') throw original; return original;
      } }).then(() => assert.fail('pending ownership must reject'), failure => failure);
    assert.equal(error.cacheOwnershipReleased(), false); settled = true; assert.equal(error.cacheOwnershipReleased(), true);
    assert.equal(calls, 1);
  } else if (['continuation', 'stale-continuation', 'scope-continuation', 'cursor-negatives'].includes(selected)) {
    const records = ['a', 'b', 'c', 'd', 'e'].map(id => decision(id));
    const first = await select(records, { maxHistory: 2 }), cursor = first.historySelection.continuation;
    assert.deepEqual(ids(first), ['a', 'b']); assert.ok(cursor);
    if (selected === 'continuation') {
      const second = await select([...records].reverse(), { maxHistory: 2, cursor });
      assert.deepEqual(ids(second), ['c', 'd']);
      const third = await select(records, { maxHistory: 2, cursor: second.historySelection.continuation });
      assert.deepEqual(ids(third), ['e']); assert.equal(third.historySelection.continuation, null);
      assert.equal(third.historySelection.continuationState, 'exact-history-exhausted');
    } else if (selected === 'stale-continuation') {
      await assert.rejects(select(records.map(record => record.recordId === 'e' ? { ...record, raw: 'changed' } : record),
        { maxHistory: 2, cursor }), { code: 'ERR_TRIAGE_HISTORY_CURSOR_STALE' });
      await assert.rejects(select(records, { maxHistory: 2, cursor: { ...cursor,
        after: { ...cursor.after, decisionId: 'unknown-boundary' } } }), { code: 'ERR_TRIAGE_HISTORY_CURSOR_STALE' });
    } else if (selected === 'scope-continuation') {
      for (const change of [{ recordsDir: path.join(recordsDir, 'other') }, { repoRoot: path.join(repoRoot, 'other') },
        { finding: { ...finding, env: 'staging' } }, { maxHistory: 3 }, { asOf: '2026-10-28T12:00:00.000Z' }]) {
        await assert.rejects(select(records, { maxHistory: 2, cursor, ...change }), { code: 'ERR_TRIAGE_HISTORY_CURSOR_STALE' });
      }
    } else {
      for (const change of [value => value.policy = 'different', value => value.schemaVersion++, value => value.extraPath = '../other',
        value => value.after.extra = true, value => value.after.timestamp = 1.5, value => value.asOf = '2026-10-27',
        value => value.snapshotHash = 'a', value => value.after.decisionId = ['a']]) {
        const candidate = structuredClone(cursor); change(candidate);
        assert.throws(() => assertTriageHistoryCursor(candidate), { code: 'ERR_TRIAGE_HISTORY_CURSOR' });
      }
      const mutable = structuredClone(cursor), captured = assertTriageHistoryCursor(mutable);
      mutable.after.decisionId = 'e'; assert.equal(captured.after.decisionId, 'b');
      assert.equal(Object.isFrozen(captured), true); assert.equal(Object.isFrozen(captured.after), true);
      for (const wire of ['{', 'null', '[]', 'false', '0', ' '.repeat(TRIAGE_HISTORY_LIMITS.cursorBytes + 1)]) {
        assert.throws(() => parseTriageHistoryCursor(wire), { code: 'ERR_TRIAGE_HISTORY_CURSOR' });
      }
      assert.deepEqual(parseTriageHistoryCursor(JSON.stringify(cursor)), cursor);
    }
  } else if (selected === 'persisted' || selected === 'legacy-renderer') {
    ({ dir: fixtureRoot } = await prepareIsolatedTestCacheDir('triage-history-lineage-' + selected));
    const records = path.join(fixtureRoot, 'records');
    await writeTriageRecordArtifacts(records, finding);
    const current = await loadTriageRecordSnapshot(records, finding.recordId, { recordType: 'finding' });
    const record = decision('saved', true, { decision: { findingRecordId: finding.recordId, status: 'accept',
      reviewer: 'saved reviewer', findingObservation: current.observation } });
    const output = await writeTriageRecordArtifacts(records, record);
    if (selected === 'persisted') {
      const result = await buildTriageHistorySelection({ ...input, recordsDir: records, findingObservation: current.observation });
      assert.deepEqual(ids(result), ['saved']); assert.equal(result.historySelection.items[0].relation, 'exactFinding');
      assert.equal(result.historySelection.items[0].observation.state, 'same');
      const view = await readTriagePublication(records, output.jsonPath);
      assert.ok(view.text.includes('Finding record')); assert.ok(view.text.includes(finding.recordId));
      assert.ok(view.text.includes('historical decision'));
    } else {
      const legacyText = renderRecordMarkdown(record, { rendererVersion: 1 });
      const wire = JSON.parse(await fs.readFile(output.jsonPath, 'utf8'));
      Object.assign(wire[TRIAGE_PUBLICATION_FIELD], { rendererVersion: 1,
        markdownHash: createHash('sha256').update(legacyText).digest('hex'), markdownBytes: Buffer.byteLength(legacyText) });
      const bytes = JSON.stringify(wire);
      await fs.writeFile(output.jsonPath, bytes); await fs.writeFile(output.generationJsonPath, bytes);
      await fs.writeFile(output.mdPath, legacyText);
      assert.equal((await readTriagePublication(records, output.jsonPath)).text, legacyText,
        'version-one immutable bytes use their original declared renderer');
      const upgraded = await writeTriageRecordArtifacts(records, record);
      assert.notEqual(upgraded.generation, output.generation);
      assert.equal(await fs.readFile(output.mdPath, 'utf8'), legacyText, 'the original immutable generation is retained');
      assert.equal((await readTriagePublication(records, upgraded.jsonPath)).publication.rendererVersion, 2);
    }
  }
} catch (error) { workError = error; }
finally {
  if (fixtureRoot) {
    try {
      if (workError) observeStorageResource(workError, { phase: 'triage-history-fixture-cleanup' }).requireSettled();
      const absolute = path.resolve(fixtureRoot), parent = path.resolve(resolveTestCachePath());
      assert.equal(path.dirname(absolute), parent); assert.ok(path.basename(absolute).startsWith('triage-history-lineage-'));
      await fs.rm(absolute, { recursive: true, force: true });
    } catch (cleanupError) { workError = workError ? addStorageFailureContext(workError, {}, cleanupError) : cleanupError; }
  }
}
if (workError) throw workError;
console.log('triage history lineage ' + selected + ' passed');
