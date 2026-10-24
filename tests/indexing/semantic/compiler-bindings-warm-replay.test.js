import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-compiler-warm-'));
const repo = path.join(temp, 'repo');
const build = () => buildIndex(repo, { mode: 'code', stage: 'stage2', incremental: true,
  'stub-embeddings': true, 'scm-provider': 'none' });
const readGeneration = async () => {
  const indexDir = getIndexDir(repo, 'code', loadUserConfig(repo));
  const manifest = JSON.parse(await fs.readFile(path.join(indexDir, 'semantic_manifest.json'), 'utf8'));
  const { store } = await openPublishedSemanticStore({ indexDir, repoRoot: repo, generation: manifest.generation });
  const bindings = [], targets = [];
  for (const partition of manifest.partitions) {
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) {
      if (row.kind === 'binding') bindings.push(JSON.stringify(row));
    }
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) {
      if (row.kind === 'callTarget') targets.push(JSON.stringify(row));
    }
  }
  return { manifest, bindings: bindings.sort(), targets: targets.sort() };
};

try {
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, 'input.ts'),
    'export function original(x: number) { return x + 1; } export function use() { return original(2); }');
  applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'stub', testConfig: {
    indexing: { semantic: { enabled: true, profile: 'rich', enrichment: { bindings: 'eager', localFlow: 'eager' } },
      embeddings: { enabled: false }, typeInference: false, typeInferenceCrossFile: false,
      riskAnalysis: false, treeSitter: { enabled: false } }
  } });
  await build();
  const cold = await readGeneration();
  assert.ok(cold.bindings.length > 0, 'cold compiler bindings exist before replay');
  assert.ok(cold.targets.length > 0, 'cold call targets exist before replay');
  assert.ok(cold.manifest.completedTasks.length > 0, 'cold semantic tasks completed');
  await build();
  const warm = await readGeneration();
  assert.notEqual(warm.manifest.generation.baseBuildId, cold.manifest.generation.baseBuildId);
  const syntaxHashes = value => value.partitions.filter(partition => partition.partitionId.startsWith('sy1:'))
    .map(partition => partition.canonicalHash).sort();
  assert.deepEqual(syntaxHashes(warm.manifest), syntaxHashes(cold.manifest),
    'warm reuse retains exact immutable syntax');
  assert.deepEqual(warm.bindings, cold.bindings, 'warm cache retains checker observations');
  assert.deepEqual(warm.targets, cold.targets, 'warm cache retains exact call targets');
  assert.ok(warm.manifest.completedTasks.length > 0);
  assert.ok(warm.manifest.completedTasks.every(receipt => receipt.baseBuildId === warm.manifest.generation.baseBuildId));
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
