import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { applyTestEnv } from '../../helpers/test-env.js';
await requireBootstrap(); applyTestEnv();
const [scenario, directory] = process.argv.slice(2);
assert.ok(['compaction', 'mixed-regeneration'].includes(scenario));
if (!directory) throw new Error('Explicit output directory is required.');
const output = path.resolve(directory); await fs.mkdir(output, { recursive: false });
const source = captureSweepSource(process.cwd()), observations = [];
for (let index = 0; index < 3; index++) {
  const result = await runQualificationCapsule({ args: ['tests/fixtures/benchmarks/vfs-restart-misses.js', scenario],
    receiptPath: path.join(output, `invocation-${index + 1}.json`), maxOutputBytes: 262144 });
  assert.equal(result.stderr, ''); assert.equal(result.outputCapture.stdout.truncated, false);
  const observation = JSON.parse(result.stdout); observations.push(observation);
  await atomicWriteJson(path.join(output, `repetition-${index + 1}.json`), { historicalAuthorWorkspace: true, source,
    capsuleMs: result.durationMs, observation }, { createOnly: true });
  console.log(JSON.stringify({ repetition: index + 1, scenario, capsuleMs: result.durationMs }));
}
assert.deepEqual(captureSweepSource(process.cwd()), source);
await atomicWriteJson(path.join(output, 'final.json'), { historicalAuthorWorkspace: true, source, scenario, observations }, { createOnly: true });
