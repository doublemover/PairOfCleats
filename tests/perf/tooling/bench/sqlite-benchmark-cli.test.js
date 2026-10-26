#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { runNode } from '../../../helpers/run-node.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('perf/tooling/bench/sqlite-benchmark-cli/')[1];
const cases = { 'build-baseline': ['build-from-bundles', 'baseline'], 'build-current': ['build-from-bundles', 'current'],
  'build-compare': ['build-from-bundles', 'compare'], 'update-baseline': ['incremental-update', 'baseline'],
  'update-current': ['incremental-update', 'current'], 'update-compare': ['incremental-update', 'compare'] };
assert.ok(Object.hasOwn(cases, selected), 'runner must select one independently bounded CLI case');
const [entry, mode] = cases[selected];
const result = runNode([path.join(process.cwd(), 'tools', 'bench', 'sqlite', `${entry}.js`),
  '--files', '6', '--chunks', '2', '--mode', mode], selected, process.cwd(), applyTestEnv({ syncProcess: false }),
{ stdio: 'pipe', timeoutMs: 30000 });
assert.equal(result.status, 0);
assert.match(result.stdout, /scope=smoke/);
assert.doesNotMatch(result.stderr || '', /ERR_INDEX_FORMAT_UNSUPPORTED|invalid bundle|update skipped/i);
const observed = result.stdout.split(/\r?\n/u).filter(line => / observed-work /u.test(line))
  .map(line => JSON.parse(line.slice(line.indexOf(' observed-work ') + ' observed-work '.length)));
assert.equal(observed.length, mode === 'compare' ? 2 : 1);
for (const row of observed) {
  assert.equal(row.files, 6); assert.equal(row.chunks, 12); assert.equal(row.postings, 24);
  assert.ok(row.sourceBytes > 0 && row.bundleBytes > 0);
  assert.match(row.stableContentSha256, /^[a-f0-9]{64}$/);
}
if (mode === 'compare') {
  assert.deepEqual(observed[0], observed[1]);
  assert.match(result.stdout, /smoke delta.*sustained performance unqualified/u);
}
if (entry === 'incremental-update') assert.match(result.stdout, /changedFiles=1 chunks=2/u);
console.log(`SQLite ${entry}/${mode} performs and validates the intended smoke workload.`);
