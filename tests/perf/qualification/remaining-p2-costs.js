import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { applyTestEnv } from '../../helpers/test-env.js';
await requireBootstrap(); applyTestEnv();
assert.ok(process.argv[2], 'An explicit fresh output directory is required.');
const output = path.resolve(process.argv[2]); await fs.mkdir(output);
const source = captureSweepSource(process.cwd()), observations = [];
assert.equal(source.state, 'clean-revision', 'Qualification requires a committed, clean source identity.');
for (let repetition = 1; repetition <= 3; repetition++) {
  const scenarios = ['comparison-one', 'comparison-many', 'thread-cancellation', 'python-escaped', 'python-identifiers'];
  for (const scenario of repetition % 2 ? scenarios : scenarios.toReversed()) {
    const name = scenario + '-' + repetition, destination = path.join(output, name);
    const result = await runQualificationCapsule({ args: ['tests/fixtures/benchmarks/remaining-p2-cost-caps.js', scenario, destination],
      receiptPath: path.join(output, name + '-invocation.json') });
    assert.equal(result.stderr, ''); assert.equal(result.outputCapture.stdout.truncated, false);
    const report = JSON.parse(await fs.readFile(path.join(destination, 'receipt.json'), 'utf8'));
    assert.equal(report.status, 'passed'); assert.equal(report.scenario, scenario);
    observations.push({ repetition, scenario, capsuleMs: result.durationMs, report });
    console.log(JSON.stringify({ name, capsuleMs: result.durationMs }));
  }
}
assert.deepEqual(captureSweepSource(process.cwd()), source);
await atomicWriteJson(path.join(output, 'final.json'), { historicalAuthorWorkspace: true, source, observations,
  scope: '15 serial fresh-process capsules;each child30s;three repetitions;no retries',
  allocations: 'separate sampled V8 JS allocation passes including collected objects;not native bytes or retained heap',
  limits: 'actual comparison registry lifetime,natural original Worker exit and saved Python scanner/replay costs;no historical throughput gain' }, { createOnly: true });
