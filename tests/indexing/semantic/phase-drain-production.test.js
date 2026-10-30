#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { semanticTaskInputHash } from '../../../src/index/semantic/frontier.js';
import { runDeferredPhaseFixture, readPhaseCompilerWitness } from '../../helpers/semantic-phase-fixture.js';

await runDeferredPhaseFixture('semantic-phase-drain-production', async ({ repoRoot, indexDir, manifest, request, runSemanticEnrichmentService }) => {
  const plan = await runSemanticEnrichmentService({ request });
  assert.deepEqual(plan.supportedExecutors, ['bind', 'localFlow', 'crossFileFlow']);
  const selected = plan.tasks.filter(task => ['localFlow', 'crossFileFlow'].includes(task.kind));
  assert.equal(selected.length, 2);
  assert.ok(selected.every(task => task.executable));
  const initial = await readPhaseCompilerWitness({ repoRoot, indexDir, generation: manifest.generation });
  const drainStart = performance.now();
  const result = await runSemanticEnrichmentService({ request: { ...request, action: 'drain', taskIds: selected.map(task => task.taskId) } });
  console.log(JSON.stringify({ phase: 'selected-phase-drain', elapsedMs: performance.now() - drainStart }));
  assert.equal(result.status, 'published');
  assert.equal(result.lineage.length, 2);
  assert.deepEqual(result.lineage.map(row => row.sourceTaskId).sort(), selected.map(row => row.taskId).sort());
  assert.ok(result.workScopes.compilerParseReused.count > 0, 'Selected normal compiler work consumes actual retained preflight trees.');
  assert.ok(result.workScopes.sourceBytesReused > 0);
  assert.ok(result.workScopes.peakRetainedBytes > 0);
  assert.equal(result.workScopes.retainedByteBasis, 'source-bytes-times-16-estimate');
  assert.ok(result.workScopes.compilerParsed, 'Fresh parses are reported alongside verified reuse.');
  assert.notEqual(result.publishedGeneration.baseBuildId, manifest.generation.baseBuildId);
  const freshDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  const current = await readPhaseCompilerWitness({ repoRoot, indexDir: freshDir, generation: result.publishedGeneration });
  assert.deepEqual(current.verifierInput, initial.verifierInput,
    'Complete sealed compiler inventory and actual verifier repo/tooling inputs must be identical across deferred and drained generations.');
  assert.equal(current.authorityHash, initial.authorityHash); assert.equal(current.verifierInputHash, initial.verifierInputHash);
  const { store, manifest: fresh } = current.inventory;
  assert.equal(fresh.completedTasks.length, 2, 'only selected phases are acknowledged');
  // The original service's beforePublish + recovery owners reverify authority
  // and exact replanned inputs. These published receipts are positive fresh
  // authority evidence, without a redundant full service plan after the drain.
  for (const line of result.lineage) {
    const old = initial.inventory.tasks.get(line.sourceTaskId), next = current.inventory.tasks.get(line.replannedTaskId);
    assert.ok(old && next); assert.notEqual(old.taskId, next.taskId); assert.deepEqual(next.dependencies, old.dependencies);
    assert.equal(next.policyHash, old.policyHash); assert.equal(line.policyHash, old.policyHash);
    assert.equal(line.inputHash, semanticTaskInputHash(old)); assert.equal(line.inputHash, semanticTaskInputHash(next));
    assert.ok(fresh.completedTasks.some(row => row.taskId === next.taskId && row.inputHash === line.inputHash && row.policyHash === line.policyHash
      && row.baseBuildId === fresh.generation.baseBuildId));
  }
  const sources = new Map(), coverage = [];
  for (const partition of fresh.partitions) {
    for await (const source of store.iterateRows(partition.partitionId, 'semantic_sources')) sources.set(source.sourceUnitId, source);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage')) coverage.push({ ...row, sourceUnitId: partition.sourceUnitId });
  }
  const analyzed = [...sources.values()].filter(source => ['javascript', 'typescript'].includes(source.language));
  assert.ok(analyzed.some(source => source.mapping?.quality === 'exact'), 'embedded source authority is retained');
  for (const source of analyzed) for (const phase of ['localFlow', 'crossFileFlow']) {
    assert.ok(coverage.some(row => row.sourceUnitId === source.sourceUnitId && row.phase === phase && ['complete', 'partial'].includes(row.state)), 'each selected source has actual phase output');
  }
  console.log(JSON.stringify({ phase: 'compiler-authority-equivalence', authorityHash: initial.authorityHash,
    verifierInputHash: initial.verifierInputHash, programSources: initial.programSourceCount, completeInventoryEqual: true, publishedLineage: result.lineage.length }));
  console.log('source-pinned local/cross flow drain and exact fresh compiler authority contract passed');
});
