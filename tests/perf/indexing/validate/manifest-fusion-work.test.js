import assert from 'node:assert/strict';
import { runNode } from '../../../helpers/run-node.js';
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('perf/indexing/validate/manifest-fusion-work/')[1];
const [, scope, arm, trial] = selected?.match(/^(small|jsonl|multipart|warm)-(fused|eager)-([123])$/) || [];
assert.ok(scope && arm && trial);
const child = runNode(['--expose-gc', 'tests/fixtures/validation/manifest-fusion-work-child.js', scope, arm, trial],
  'bounded full-validator artifact work', process.cwd(), process.env,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 10000, maxOutputBytes: 128 * 1024 });
console.log(child.stdout.trim()); assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, '');
const sample = JSON.parse(child.stdout);
assert.equal(sample.scope, scope); assert.equal(sample.arm, arm); assert.equal(sample.trial, Number(trial));
assert.match(sample.inputDigest, /^[a-f0-9]{64}$/); assert.match(sample.outputDigest, /^[a-f0-9]{64}$/);
