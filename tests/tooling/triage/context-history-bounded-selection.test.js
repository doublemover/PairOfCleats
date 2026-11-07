import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { buildTriageHistorySelection } from '../../../tools/triage/history-selection.js';
import { TRIAGE_HISTORY_READ_CONCURRENCY, TRIAGE_HISTORY_DIAGNOSTIC_SAMPLES } from '../../../tools/triage/history-scan.js';
import { MinHeap } from '../../../src/shared/min-heap.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual queue/heap/history selection; synthetic read scheduling is
// not a throughput/RSS benchmark. Real small files exercise the default reader.
const recordsDir = path.resolve('.tmp', 'triage-selection-corpus');
const repoRoot = path.resolve('.tmp', 'triage-selection-repo');
const select = options => buildTriageHistorySelection({ repoRoot, recordsDir, recordId: 'current', finding,
  asOf: '2026-11-06T00:00:00.000Z', ...options });
const finding = { recordId: 'current', recordType: 'finding', source: 'generic', service: 'api', env: 'prod', vuln: { cve: 'CVE-TARGET' },
  package: { name: 'target', manifestPath: 'src/package.json' } };
const corpus = Array.from({ length: 1024 }, (_, ordinal) => {
  const route = ordinal < 2, direct = ordinal % 11 === 0, vuln = ordinal % 2 === 0;
  const pkg = ordinal % 3 === 0, manifest = ordinal % 5 === 0, env = route || ordinal % 7 === 0;
  return { recordId: `decision-${String(ordinal).padStart(4, '0')}`, recordType: ordinal % 13 === 0 ? 'finding' : 'decision', source: 'manual',
    service: route ? 'api' : 'worker', env: env ? 'prod' : 'dev',
    decision: { findingRecordId: direct ? 'current' : 'different' }, vuln: { cve: vuln ? 'CVE-TARGET' : 'CVE-OTHER' },
    package: { name: pkg ? 'target' : 'other', manifestPath: manifest ? 'vendor/package.json' : 'other.lock' },
    updatedAt: new Date(1700000000000 + ordinal % 4).toISOString(),
    ordinal, expectedScore: (direct ? 8 : 0) + (vuln ? 4 : 0) + (pkg ? 3 : 0) + (manifest ? 2 : 0) + (route ? 1 : 0) + (env ? 1 : 0),
    expectedRoute: route };
});
// Exercise reserved exact links and route-scoped related records together.
corpus[0].recordType = 'decision';
const entries = corpus.map(record => ({ name: record.recordId + '.json', isFile: () => true }));
entries.push({ name: 'ignored.md', isFile: () => true }, { name: 'directory.json', isFile: () => false });
const eligible = corpus.filter(record => record.recordType === 'decision' && record.expectedScore > 0);
const newest = (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  || (left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0);
const exact = eligible.filter(record => record.decision.findingRecordId === 'current').sort(newest);
const related = eligible.filter(record => record.decision.findingRecordId !== 'current')
  .sort((left, right) => Number(right.expectedRoute) - Number(left.expectedRoute)
    || right.expectedScore - left.expectedScore || newest(left, right));
const oracle = exact.slice(0, 3);
const initiallySelectedExact = oracle.length;
oracle.push(...related.slice(0, 5 - oracle.length));
oracle.push(...exact.slice(initiallySelectedExact, initiallySelectedExact + 5 - oracle.length));
const byId = new Map(corpus.map(record => [record.recordId, record]));

let reads = 0, active = 0, peak = 0;
const warnings = [], heapPeaks = new Map(), push = MinHeap.prototype.push;
try {
  MinHeap.prototype.push = function (candidate) {
    const result = push.call(this, candidate);
    heapPeaks.set(this, Math.max(heapPeaks.get(this) || 0, this.size));
    return result;
  };
  const selected = await select({ recordsDir, recordId: 'current', finding, maxHistory: 5, warnings,
    readDirectory: async () => entries, readRecord: async file => {
      reads++; active++; peak = Math.max(peak, active);
      try { await new Promise(resolve => setImmediate(resolve)); return byId.get(path.basename(file, '.json')); }
      finally { active--; }
    } });
  assert.deepEqual(selected.history, oracle, 'bounded retained selection equals independent exact-reserved/route/score/time/ID ordering');
  assert.equal(reads, corpus.length); assert.equal(active, 0); assert.ok(peak > 1 && peak <= TRIAGE_HISTORY_READ_CONCURRENCY);
  assert.equal(heapPeaks.size, 3); assert.ok([...heapPeaks.values()].every(size => size <= 6), 'each heap retains K plus one transient candidate');
  assert.deepEqual(warnings, []);
} finally { MinHeap.prototype.push = push; }

for (const maxHistory of [0, -1, -1.5]) assert.deepEqual((await select({ finding,
  maxHistory, warnings: [], readDirectory() { assert.fail('zero effective budget must not scan'); },
  readRecord() { assert.fail('zero effective budget must not read'); } })).history, []);

// Duplicate IDs from different filenames were an ordinal-tie behavior of the
// removed selector. Canonical reads now reject that contradictory authority;
// the real-file cases below verify both mismatched files are refused.
const failedWarnings = [];
assert.deepEqual((await select({ finding, recordId: 'current', maxHistory: 5,
  warnings: failedWarnings, readDirectory: async () => entries.slice(0, 20),
  readRecord: async file => { throw Object.assign(new Error('read failed access_token=secret'), { code: 'EIO', file }); }
})).history, []);
assert.equal(failedWarnings.length, 1); assert.equal(failedWarnings[0].failed, 20);
assert.equal(failedWarnings[0].samples.length, TRIAGE_HISTORY_DIAGNOSTIC_SAMPLES);
assert.equal(failedWarnings[0].omittedSamples, 20 - TRIAGE_HISTORY_DIAGNOSTIC_SAMPLES);
assert.ok(failedWarnings[0].samples.every(sample => sample.code === 'EIO' && !sample.error.includes('secret')));

const primary = Object.assign(new Error('history read retains original native work'), {
  cacheOwnershipPending: false, cacheOwnershipReleased() { return false; }
});
await assert.rejects(select({ recordsDir, finding, maxHistory: 5, warnings: [],
  readDirectory: async () => entries.slice(0, 1), readRecord: async () => { throw primary; }
}), error => error.cacheOwnershipReleased() === false,
'an incomplete-history warning cannot hide retained native ownership');
await assert.rejects(select({ recordsDir, finding, maxHistory: 5, warnings: [],
  readDirectory: async () => { throw primary; }
}), error => error.cacheOwnershipReleased() === false,
'directory diagnostics also retain original pending work');
for (const maxHistory of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(
  select({ recordsDir, finding, maxHistory, warnings: [],
    readDirectory() { assert.fail('invalid internal budget must fail before scanning'); } }), TypeError);

const root = await makeTempDir('poc-triage-history-bounds-');
try {
  const record = { recordId: 'original', recordType: 'decision', source: 'manual', service: 'api', env: 'prod', decision: { findingRecordId: 'current' } };
  await fs.writeFile(path.join(root, 'original.json'), JSON.stringify(record));
  await fs.writeFile(path.join(root, 'malformed.json'), '{');
  await fs.writeFile(path.join(root, 'primitive.json'), 'false');
  await fs.writeFile(path.join(root, 'current.json'), JSON.stringify(finding));
  const warnings = [];
  assert.deepEqual((await select({ recordsDir: root, finding, maxHistory: 5, warnings })).history, [record]);
  assert.equal(warnings[0].failed, 2); assert.equal(warnings[0].samples.length, 2);
  const missing = [];
  assert.deepEqual((await select({ recordsDir: path.join(root, 'absent'), finding, maxHistory: 5, warnings: missing })).history, []);
  assert.equal(missing[0].step, 'history-scan'); assert.equal(missing[0].code, 'ENOENT');
  const empty = path.join(root, 'empty'); await fs.mkdir(empty);
  const noWarnings = [];
  assert.deepEqual((await select({ recordsDir: empty, finding, maxHistory: 5, warnings: noWarnings })).history, []);
  assert.deepEqual(noWarnings, []);
  const contradictory = path.join(root, 'contradictory'); await fs.mkdir(contradictory);
  await fs.writeFile(path.join(contradictory, 'first.json'), JSON.stringify({ ...record, recordId: 'same' }));
  await fs.writeFile(path.join(contradictory, 'second.json'), JSON.stringify({ ...record, recordId: 'same' }));
  const identityWarnings = [];
  assert.deepEqual((await select({ recordsDir: contradictory, warnings: identityWarnings })).history, []);
  assert.equal(identityWarnings[0].failed, 2);
  assert.ok(identityWarnings[0].samples.every(sample => sample.code === 'ERR_TRIAGE_RECORD_IDENTITY'),
    'contradictory record/file identities cannot select an arbitrary ordinal winner');
} finally { await rmDirRecursive(root); }
console.log('Bounded current history selection, independent rank oracle and explicit failure controls passed.');
