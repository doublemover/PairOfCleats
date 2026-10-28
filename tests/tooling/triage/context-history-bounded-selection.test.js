import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { buildTriageHistory, TRIAGE_HISTORY_READ_CONCURRENCY, TRIAGE_HISTORY_DIAGNOSTIC_SAMPLES } from '../../../tools/triage/history.js';
import { MinHeap } from '../../../src/shared/min-heap.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual queue/heap/history selection; synthetic read scheduling is
// not a throughput/RSS benchmark. Real small files exercise the default reader.
const finding = { recordId: 'current', recordType: 'finding', source: 'generic', service: 'api', env: 'prod', vuln: { cve: 'CVE-TARGET' },
  package: { name: 'target', manifestPath: 'src/package.json' } };
const corpus = Array.from({ length: 1024 }, (_, ordinal) => {
  const route = ordinal < 2, direct = ordinal % 11 === 0, vuln = ordinal % 2 === 0;
  const pkg = ordinal % 3 === 0, manifest = ordinal % 5 === 0, env = route || ordinal % 7 === 0;
  return { recordId: `decision-${String(ordinal).padStart(4, '0')}`, recordType: ordinal % 13 === 0 ? 'finding' : 'decision',
    service: route ? 'api' : 'worker', env: env ? 'prod' : 'dev',
    decision: { findingRecordId: direct ? 'current' : 'different' }, vuln: { cve: vuln ? 'CVE-TARGET' : 'CVE-OTHER' },
    package: { name: pkg ? 'target' : 'other', manifestPath: manifest ? 'vendor/package.json' : 'other.lock' },
    updatedAt: new Date(1700000000000 + ordinal % 4).toISOString(),
    ordinal, expectedScore: (direct ? 8 : 0) + (vuln ? 4 : 0) + (pkg ? 3 : 0) + (manifest ? 2 : 0) + (route ? 1 : 0) + (env ? 1 : 0),
    expectedRoute: route };
});
// Ensure two route-scoped records remain before even stronger relaxed scores.
corpus[0].recordType = 'decision';
const entries = corpus.map((_, index) => ({ name: `${index}.json`, isFile: () => true }));
entries.push({ name: 'ignored.md', isFile: () => true }, { name: 'directory.json', isFile: () => false });
const oracle = corpus.filter(record => record.recordType === 'decision' && record.expectedScore > 0)
  .sort((left, right) => Number(right.expectedRoute) - Number(left.expectedRoute)
    || right.expectedScore - left.expectedScore || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    || left.recordId.localeCompare(right.recordId) || left.ordinal - right.ordinal).slice(0, 5);
let reads = 0, active = 0, peak = 0;
const warnings = [], heapPeaks = new Map(), push = MinHeap.prototype.push;
try {
  MinHeap.prototype.push = function (candidate) {
    const result = push.call(this, candidate);
    heapPeaks.set(this, Math.max(heapPeaks.get(this) || 0, this.size));
    return result;
  };
  const selected = await buildTriageHistory({ recordsDir: '/synthetic', recordId: 'current', finding, maxHistory: 5, warnings,
    readDirectory: async () => entries, readRecord: async file => {
      reads++; active++; peak = Math.max(peak, active);
      try { await new Promise(resolve => setImmediate(resolve)); return corpus[Number(path.basename(file, '.json'))]; }
      finally { active--; }
    } });
  assert.deepEqual(selected, oracle, 'bounded retained selection equals independent full route/score/time/ID ordering');
  assert.equal(reads, corpus.length); assert.equal(active, 0); assert.ok(peak > 1 && peak <= TRIAGE_HISTORY_READ_CONCURRENCY);
  assert.equal(heapPeaks.size, 2); assert.ok([...heapPeaks.values()].every(size => size <= 6), 'each heap retains K plus one transient candidate');
  assert.deepEqual(warnings, []);
} finally { MinHeap.prototype.push = push; }

for (const maxHistory of [0, -1, -1.5]) assert.deepEqual(await buildTriageHistory({ recordsDir: '/unused', finding,
  maxHistory, warnings: [], readDirectory() { assert.fail('zero effective budget must not scan'); },
  readRecord() { assert.fail('zero effective budget must not read'); } }), []);

const tied = [{ recordType: 'decision', recordId: 'same', service: 'api', env: 'prod', original: 'first' },
  { recordType: 'decision', recordId: 'same', service: 'api', env: 'prod', original: 'second' }];
const held = Promise.withResolvers();
const tiedResult = await buildTriageHistory({ recordsDir: '/ties', finding, recordId: 'current', maxHistory: 1, warnings: [],
  readDirectory: async () => entries.slice(0, 2), readRecord: async file => {
    const index = Number(path.basename(file, '.json'));
    if (index === 0) await held.promise;
    else held.resolve();
    return tied[index];
  } });
assert.deepEqual(tiedResult, [tied[0]], 'directory ordinal preserves prior stable sort ties despite reversed read completion');
const failedWarnings = [];
assert.deepEqual(await buildTriageHistory({ recordsDir: '/failures', finding, recordId: 'current', maxHistory: 5,
  warnings: failedWarnings, readDirectory: async () => entries.slice(0, 20),
  readRecord: async file => { throw Object.assign(new Error('read failed access_token=secret'), { code: 'EIO', file }); }
}), []);
assert.equal(failedWarnings.length, 1); assert.equal(failedWarnings[0].failed, 20);
assert.equal(failedWarnings[0].samples.length, TRIAGE_HISTORY_DIAGNOSTIC_SAMPLES);
assert.equal(failedWarnings[0].omittedSamples, 20 - TRIAGE_HISTORY_DIAGNOSTIC_SAMPLES);
assert.ok(failedWarnings[0].samples.every(sample => sample.code === 'EIO' && !sample.error.includes('secret')));

const primary = Object.assign(new Error('history read retains original native work'), {
  cacheOwnershipPending: false, cacheOwnershipReleased() { return false; }
});
await assert.rejects(buildTriageHistory({ recordsDir: '/pending', finding, maxHistory: 5, warnings: [],
  readDirectory: async () => entries.slice(0, 1), readRecord: async () => { throw primary; }
}), error => error.cacheOwnershipReleased() === false,
'an incomplete-history warning cannot hide retained native ownership');
await assert.rejects(buildTriageHistory({ recordsDir: '/pending-scan', finding, maxHistory: 5, warnings: [],
  readDirectory: async () => { throw primary; }
}), error => error.cacheOwnershipReleased() === false,
'directory diagnostics also retain original pending work');
for (const maxHistory of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(
  buildTriageHistory({ recordsDir: '/invalid-budget', finding, maxHistory, warnings: [],
    readDirectory() { assert.fail('invalid internal budget must fail before scanning'); } }), TypeError);

const root = await makeTempDir('poc-triage-history-bounds-');
try {
  const record = { recordId: 'original', recordType: 'decision', source: 'manual', service: 'api', env: 'prod', decision: { findingRecordId: 'current' } };
  await fs.writeFile(path.join(root, 'original.json'), JSON.stringify(record));
  await fs.writeFile(path.join(root, 'malformed.json'), '{');
  await fs.writeFile(path.join(root, 'primitive.json'), 'false');
  await fs.writeFile(path.join(root, 'finding.json'), JSON.stringify(finding));
  const warnings = [];
  assert.deepEqual(await buildTriageHistory({ recordsDir: root, finding, recordId: 'current', maxHistory: 5, warnings }), [record]);
  assert.equal(warnings[0].failed, 2); assert.equal(warnings[0].samples.length, 2);
  const missing = [];
  assert.deepEqual(await buildTriageHistory({ recordsDir: path.join(root, 'absent'), finding, maxHistory: 5, warnings: missing }), []);
  assert.equal(missing[0].step, 'history-scan'); assert.equal(missing[0].code, 'ENOENT');
  const empty = path.join(root, 'empty'); await fs.mkdir(empty);
  const noWarnings = [];
  assert.deepEqual(await buildTriageHistory({ recordsDir: empty, finding, maxHistory: 5, warnings: noWarnings }), []);
  assert.deepEqual(noWarnings, []);
} finally { await rmDirRecursive(root); }
console.log('Bounded history queue/heap, stable rank parity and explicit failure controls authored; execution deferred.');
