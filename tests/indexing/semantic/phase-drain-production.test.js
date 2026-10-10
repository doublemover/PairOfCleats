#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runSemanticEnrichmentService } from '../../../src/semantic/enrichment.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-semantic-phase-drain-'));
const repoRoot = path.join(temp, 'repo');
await fs.mkdir(repoRoot);
await fs.writeFile(path.join(repoRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { types: [], target: 'ES2022' }, include: ['*.ts'] }));
await fs.writeFile(path.join(repoRoot, 'input.ts'), 'export function scale(x:number) { return x*2; } export function run() { const payload={value:scale(3)}; return payload.value; }');
await fs.writeFile(path.join(repoRoot, 'input.vue'), '<template>Hello</template><script lang="ts">export function wrap(x:number) { return x+1; } const result=wrap(4);</script>');
applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'stub', testConfig: { indexing: {
  workerPool: { enabled: false }, semantic: { enabled: true, profile: 'rich', enrichment: { bindings: 'deferred', localFlow: 'deferred', crossFileFlow: 'deferred' } },
  embeddings: { enabled: false }, typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, treeSitter: { enabled: false }
} } });
try {
  await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', incremental: false, 'stub-embeddings': true, 'scm-provider': 'none' });
  const indexDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  const manifest = JSON.parse(await fs.readFile(path.join(indexDir, 'semantic_manifest.json'), 'utf8'));
  assert.equal(manifest.completedTasks.length, 0);
  const request = { schemaVersion: 1, repoRoot, generation: manifest.generation, limits: { maxTasks: 32, maxBytes: 65536, maxMs: 30000, drainMaxMs: 30000 } };
  const plan = await runSemanticEnrichmentService({ request });
  assert.deepEqual(plan.supportedExecutors, ['bind', 'localFlow', 'crossFileFlow']);
  const selected = plan.tasks.filter(task => ['localFlow', 'crossFileFlow'].includes(task.kind));
  assert.equal(selected.length, 2);
  assert.ok(selected.every(task => task.executable));
  const result = await runSemanticEnrichmentService({ request: { ...request, action: 'drain', taskIds: selected.map(task => task.taskId) } });
  assert.equal(result.status, 'published');
  assert.equal(result.lineage.length, 2);
  assert.notEqual(result.publishedGeneration.baseBuildId, manifest.generation.baseBuildId);
  const freshDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  const { store, manifest: fresh } = await openPublishedSemanticStore({ indexDir: freshDir, repoRoot, generation: result.publishedGeneration });
  assert.equal(fresh.completedTasks.length, 2, 'only selected phases are acknowledged');
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
  await fs.writeFile(path.join(repoRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { types: [], strict: true } }));
  await assert.rejects(runSemanticEnrichmentService({ request: { ...request, generation: fresh.generation } }), { code: 'ERR_SEMANTIC_DEPENDENCY_UNSEALED' });
  console.log('source-pinned local/cross flow drain and changed compiler authority contract passed');
} finally { await fs.rm(temp, { recursive: true, force: true }); }
