#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareSemanticBindingWork } from '../../../src/index/semantic/build-frontier.js';
import { semanticTaskInputHash } from '../../../src/index/semantic/frontier.js';
import { createSemanticTaskId } from '../../../src/index/semantic/identity.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createBindingWorkFixture } from '../../helpers/semantic-binding-work.js';

const fixture = await createBindingWorkFixture();
try {
  const work = await prepareSemanticBindingWork({ state: fixture.state, runtime: fixture.runtime });
  assert.equal(work.task.kind, 'bind'); assert.equal(work.task.sourceUnits.length, 2);
  let executed = 0;
  assert.deepEqual(await work.run(() => { executed += 1; }), { ran: false, reason: 'manual_deferred_binding_task' });
  assert.equal(executed, 0); assert.equal(fixture.state.semanticCompletedTasks, undefined);
  const control = fixture.openControl();
  try {
    assert.equal(control.getTask(work.task.taskId).state, 'pending');
    assert.equal(control.getTask(work.task.taskId).inputHash, semanticTaskInputHash(work.task));
    assert.equal(control.getOutput(work.task.taskId), null);
    const unrelated = { ...work.task, kind: 'crossFileFlow', targetSetHash: 'a'.repeat(64), priority: 999,
      coverageToProduce: ['crossFileFlow'], taskId: createSemanticTaskId({ kind: 'crossFileFlow', inputHashes: work.task.inputHashes,
        policyHash: work.task.policyHash, targetSetHash: 'a'.repeat(64) }) };
    control.enqueue({ task: unrelated, durableInputHashes: new Set(work.task.inputHashes) });
    const [lease] = control.leaseReady({ baseBuildId: work.task.baseBuildId, taskId: work.task.taskId, owner: 'exact-test', now: 1, leaseMs: 10 });
    assert.equal(lease.taskId, work.task.taskId);
    assert.equal(control.getTask(unrelated.taskId).state, 'pending');
    assert.equal(control.getTask(unrelated.taskId).attempt, 0, 'exact binding lease never consumes unrelated ready CFG work');
    assert.throws(() => control.renew({ taskId: work.task.taskId, owner: 'exact-test', now: 11, leaseMs: 10 }), { code: 'ERR_SEMANTIC_LEASE_LOST' });
  } finally { control.close(); }
  const targets = fixture.state.semanticFrontierTargets[0];
  const targetSet = JSON.parse(await fs.readFile(path.join(fixture.buildRoot, fixture.storage.relativePath, targets.path), 'utf8'));
  assert.deepEqual(targetSet.generation, fixture.generation);
  assert.equal(targetSet.syntaxPartitionRefs.length, 2);
  const primary = [...fixture.state.semanticFactsByFile.values()].find(entry => entry.partitions.some(partition => partition.members.semantic_frontier.length));
  const store = createArtifactSemanticStore({ root: path.join(fixture.buildRoot, fixture.storage.relativePath), repoRoot: fixture.repoRoot,
    generation: fixture.generation, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, partitions: primary.partitions });
  const taskRows = [];
  for (const partition of primary.partitions) for await (const row of store.iterateRows(partition.partitionId, 'semantic_frontier')) taskRows.push(row);
  assert.deepEqual(taskRows, [work.task], 'durable immutable descriptor exists before control-store execution');

  const unavailable = await createBindingWorkFixture({ bindings: 'eager' });
  try {
    unavailable.runtime.semanticFrontierDatabase = null;
    const pending = await prepareSemanticBindingWork({ state: unavailable.state, runtime: unavailable.runtime });
    assert.equal((await pending.run(() => { throw new Error('must not execute'); })).reason, 'sqlite_control_store_unavailable');
    assert.ok(pending.task); assert.equal(unavailable.state.semanticCompletedTasks, undefined);
  } finally { await unavailable.cleanup(); }
  console.log('generation-pinned grouped manual binding task, durable targets, unavailable control store and exact leases passed');
} finally { await fixture.cleanup(); }
