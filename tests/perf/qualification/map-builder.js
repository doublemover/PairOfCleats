import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { createSqliteBenchWorkspace } from '../../../tools/bench/sqlite/shared.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { applyTestEnv } from '../../helpers/test-env.js';
await requireBootstrap(); applyTestEnv();
if (!process.argv[2]) throw new Error('Explicit output directory required.');
const output = path.resolve(process.argv[2]); await fs.mkdir(output, { recursive: false });
// Reuse the existing generated-artifact work owner, never source/index deletion
// authority inferred from the map inputs or caller-supplied paths.
const workspace = await createSqliteBenchWorkspace({ name: 'map-builder-qualification' }), source = captureSweepSource(process.cwd());
const invoke = async (command, index, capture = null) => {
  const result = await runQualificationCapsule({ args: ['tests/fixtures/benchmarks/map-builder-caps.js',
    JSON.stringify({ command, root: workspace.tempRoot, runIdentity: workspace.workOwner.runIdentity, capture })],
  receiptPath: path.join(output, `invocation-${index}.json`) });
  assert.equal(result.stderr, ''); assert.equal(result.outputCapture.stdout.truncated, false);
  const observed = JSON.parse(result.stdout);
  await atomicWriteJson(path.join(output, `capsule-${index}.json`), { historicalAuthorWorkspace: true, source,
    capsuleMs: result.durationMs, observed }, { createOnly: true });
  console.log(JSON.stringify({ command, capsule: index, capsuleMs: result.durationMs })); return observed;
};
const prepared = await invoke('prepare', 0), observations = [];
for (let repetition = 1; repetition <= 3; repetition++) observations.push(await invoke('observe', repetition, prepared.descriptor));
assert.deepEqual(captureSweepSource(process.cwd()), source);
const generatedWork = await workspace.workOwner.reclaim();
await atomicWriteJson(path.join(output, 'final.json'), { historicalAuthorWorkspace: true, source,
  claim: 'actual builder materialization/final-inclusive memory over canonical authored index inputs;not-synthetic-serializer-or-parser-performance',
  prepared, observations, generatedWork }, { createOnly: true });
