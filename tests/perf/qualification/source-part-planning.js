import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { applyTestEnv } from '../../helpers/test-env.js';

await requireBootstrap(); applyTestEnv();
assert.ok(process.argv[2], 'An explicit fresh output directory is required.');
const output = path.resolve(process.argv[2]); await fs.mkdir(output);
const requested = process.argv.slice(3).map(Number), selected = requested.length ? requested : [1, 10, 1000];
assert.equal(new Set(selected).size, selected.length); assert.ok(selected.every(value => [1, 10, 1000].includes(value)));
const source = captureSweepSource(process.cwd()), observations = [];
assert.equal(source.state, 'clean-revision', 'Source-part planning measurements require a committed clean source.');
for (let repetition = 1; repetition <= 3; repetition++) {
  for (const shards of repetition % 2 ? selected : selected.toReversed()) {
    const name = `shards-${shards}-${repetition}`, destination = path.join(output, name);
    const result = await runQualificationCapsule({ args: ['tests/fixtures/benchmarks/source-part-planning-costs.js', String(shards), destination],
      receiptPath: path.join(output, name + '-invocation.json') });
    assert.equal(result.stderr, ''); assert.equal(result.stdout, '');
    const receipt = JSON.parse(await fs.readFile(path.join(destination, 'receipt.json'), 'utf8'));
    assert.equal(receipt.status, 'passed'); assert.equal(receipt.report.shards, shards);
    observations.push({ repetition, shards, capsuleMs: result.durationMs, receipt });
    console.log(JSON.stringify({ name, capsuleMs: result.durationMs }));
  }
}
for (const shards of selected) {
  const reports = observations.filter(row => row.shards === shards).map(row => row.receipt.report);
  assert.equal(reports.length, 3); assert.equal(new Set(reports.map(row => row.inputSha256)).size, 1);
  for (const report of reports) assert.deepEqual(report.ordering, reports[0].ordering);
}
assert.deepEqual(captureSweepSource(process.cwd()), source);
await atomicWriteJson(path.join(output, 'final.json'), { schemaVersion: 1, issue: 1572, historicalAuthorWorkspace: true, source,
  selectedShards: selected, expectedCapsules: selected.length * 3, observations,
  scope: 'three serial fresh children per selected1/10/1000-shard cohort;each30seconds;zero retries;clean CPU/wall separate from allocation and endpoint-retention observations',
  limits: 'valid-input sequential canonical-lookup comparator;no historical performance gain or exact native/transient/private-Map retention claim' }, { createOnly: true });
