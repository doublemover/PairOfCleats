import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { applyTestEnv } from '../../helpers/test-env.js';

await requireBootstrap(); applyTestEnv();
assert.ok(process.argv[2], 'Explicit fresh comparison receipt directory is required.');
const output = path.resolve(process.argv[2]); await fs.mkdir(output);
const source = captureSweepSource(process.cwd()), observations = [];
assert.equal(source.state, 'clean-revision');
for (let repetition = 1; repetition <= 3; repetition++) {
  for (const arm of repetition % 2 ? ['original', 'current'] : ['current', 'original']) {
    const name = arm + '-' + repetition, destination = path.join(output, name);
    const result = await runQualificationCapsule({ args: ['tests/fixtures/benchmarks/tree-sitter-cache-warm-compat.js', arm, destination],
      receiptPath: path.join(output, name + '-invocation.json') });
    assert.equal(result.stderr, ''); assert.equal(result.stdout, '');
    const receipt = JSON.parse(await fs.readFile(path.join(destination, 'receipt.json'), 'utf8'));
    assert.equal(receipt.status, 'passed'); assert.equal(receipt.report.arm, arm);
    observations.push({ repetition, arm, capsuleMs: result.durationMs, receipt });
    console.log(JSON.stringify({ name, capsuleMs: result.durationMs }));
  }
}
const reports = observations.map(row => row.receipt.report);
assert.equal(new Set(reports.map(row => row.sourceCorpusSha256)).size, 1);
assert.equal(new Set(reports.map(row => row.semanticCorpusSha256)).size, 1);
for (const report of reports) assert.deepEqual(report.corpus, reports[0].corpus);
assert.deepEqual(captureSweepSource(process.cwd()), source);
await atomicWriteJson(path.join(output, 'final.json'), { historicalAuthorWorkspace: true, source, issue: 1759, observations,
  scope: 'six serial fresh bounded children;three counterbalanced original-cache/current-cache pairs;32 identical source/semantic products per phase',
  limits: 'owner-only historical baseline with current native producer/dependencies;schema1/2 physical envelopes differ;no whole-tree/historical RSS or performance-gain claim' }, { createOnly: true });
