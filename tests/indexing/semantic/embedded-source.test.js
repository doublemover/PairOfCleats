#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-semantic-embedded-'));
const repoRoot = path.join(temp, 'repo'); await fs.mkdir(repoRoot);
const text = '<template>hé😀</template>\r\n<script lang="ts">\r\nexport function run(buffer: ArrayBuffer) { const view = new Float32Array(buffer); f(1,2,3,4,5,{values:view,items:[1,,3]}); return view; }\r\n</script>\r\n<script setup>\r\nconst greeting = "hé😀"; call(greeting);\r\n</script>';
await fs.writeFile(path.join(repoRoot, 'input.vue'), text);
applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'stub', testConfig: {
  indexing: { workerPool: { enabled: false }, semantic: { enabled: true, profile: 'rich', enrichment: { bindings: 'off' } }, embeddings: { enabled: false }, typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, treeSitter: { enabled: false } }
} });
try {
  const build = async () => { await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', incremental: true, 'stub-embeddings': true, 'scm-provider': 'none' }); const dir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot)); return { dir, manifest: JSON.parse(await fs.readFile(path.join(dir, 'semantic_manifest.json'), 'utf8')) }; };
  const cold = await build(), warm = await build();
  assert.notEqual(cold.manifest.generation.baseBuildId, warm.manifest.generation.baseBuildId);
  const cached = warm.manifest.partitions.filter(p => Object.values(p.members).flat().every(piece => piece.path.startsWith('semantic-cache-')));
  assert.ok(cached.length >= 6, 'parent and each script syntax/ownership must reuse immutable cache');
  for (const partition of cached) assert.ok(cold.manifest.partitions.some(p => p.partitionId === partition.partitionId && p.canonicalHash === partition.canonicalHash), 'warm relocation preserves canonical cache facts');
  assert.ok(warm.manifest.partitions.filter(p => p.partitionId.startsWith('sy1:')).every(p => cached.includes(p)));
  const store = createArtifactSemanticStore({ root: path.join(warm.dir, 'semantic'), repoRoot, artifactSurfaceVersion: warm.manifest.artifactSurfaceVersion, generation: warm.manifest.generation, partitions: warm.manifest.partitions });
  const sources = [];
  for (const p of warm.manifest.partitions.filter(p => p.partitionId.startsWith('sy1:'))) for await (const source of store.iterateRows(p.partitionId, 'semantic_sources')) sources.push({ source, p });
  const parent = sources.find(x => x.source.path === 'input.vue'); assert.ok(parent);
  const segments = sources.filter(x => x.source.mapping && ['javascript','typescript'].includes(x.source.language)); assert.equal(segments.length, 2);
  assert.equal(new Set(segments.map(x => x.source.sourceUnitId)).size, 2);
  let sixth = false, hole = false, ownership = false;
  for (const { source, p } of segments) {
    assert.equal(source.mapping.parentSourceUnitId, parent.source.sourceUnitId); assert.equal(source.mapping.quality, 'exact');
    const map = JSON.parse(await fs.readFile(path.join(warm.dir, 'semantic', source.mapping.mapRef), 'utf8'));
    const local = await fs.readFile(path.join(warm.dir, 'semantic', 'semantic-sources', source.byteHash + '.utf8'), 'utf8');
    assert.equal(local, text.slice(map.parentStart, map.parentEnd)); assert.equal(local.length, source.textLength);
    const records = []; for await (const row of store.iterateRows(p.partitionId, 'semantic_records')) { records.push(row); if (row.span) assert.ok(row.span[0] >= 0 && row.span[1] <= local.length); }
    const call = records.find(row => row.data.syntacticArgumentCount === 6);
    const operands = []; for await (const row of store.iterateRows(p.partitionId, 'semantic_operands')) operands.push(row);
    if (call) { assert.equal(operands.filter(row => row.parent.localId === call.id && row.slot === 'argument').length, 6); sixth = true; }
    hole ||= operands.some(row => row.child === null && row.flags.includes('hole'));
    for (const analysis of warm.manifest.partitions.filter(a => a.sourceUnitId === source.sourceUnitId && a.partitionId !== p.partitionId)) for await (const join of store.iterateRows(analysis.partitionId, 'semantic_ownership')) { assert.equal(join.recordRef.partitionId, p.partitionId); ownership = true; }
  }
  assert.ok(sixth); assert.ok(hole); assert.ok(ownership);
  console.log('embedded source exact mapping, ownership and warm cache passed');
} finally { await fs.rm(temp, { recursive: true, force: true }); }
