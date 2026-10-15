import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRuntimeImportFixture } from './runtime-import-fixture.js';
import { applyTestEnv } from './test-env.js';
import { buildIndex } from '../../src/integrations/core/index.js';
import { openPublishedSemanticStore } from '../../src/semantic/published-store.js';
import { getIndexDir, loadUserConfig } from '../../tools/shared/dict-utils.js';

/** Positive runtime-reference fixtures use a real published one-function store.
 * Saved input samples remain synthetic; the indexed function is never executed.
 */
export const createVerifiedRuntimeImportFixture = async () => {
  const fixture = await createRuntimeImportFixture();
  try {
    const repoRoot = path.join(fixture.root, 'repo');
    await fs.mkdir(repoRoot);
    await fs.writeFile(path.join(repoRoot, 'work.js'), 'function work(x) { return x + 1; }\n');
    applyTestEnv({ cacheRoot: path.join(fixture.root, 'cache'), embeddings: 'stub', testConfig: { indexing: {
      workerPool: { enabled: false }, semantic: { enabled: true, profile: 'targeted',
        enrichment: { bindings: 'deferred', localFlow: 'deferred', crossFileFlow: 'deferred' } },
      embeddings: { enabled: false }, typeInference: false, typeInferenceCrossFile: false,
      riskAnalysis: false, treeSitter: { enabled: false }
    } } });
    await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', incremental: false,
      'stub-embeddings': true, 'scm-provider': 'none' });
    const indexDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
    const { store, manifest } = await openPublishedSemanticStore({ repoRoot, indexDir });
    let source;
    const targets = [];
    for (const partition of manifest.partitions) {
      for await (const row of store.iterateRows(partition.partitionId, 'semantic_sources')) if (row.path === 'work.js') source = row;
      for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) {
        if (row.kind === 'scope' && row.data.scopeKind === 'FunctionDeclaration') targets.push({ partitionId: partition.partitionId, localId: row.id });
      }
    }
    assert.ok(source); assert.equal(targets.length, 1);
    assert.equal(source.byteHash, fixture.source.byteHash, 'published source matches the exact saved script hash');
    fixture.source = source;
    fixture.capture.repositoryNamespace = source.repositoryNamespace;
    fixture.capture.generation = manifest.generation;
    fixture.capture.sources = [{ sourceUnitId: source.sourceUnitId, byteHash: source.byteHash }];
    fixture.capture.warnings = ['saved synthetic fixture; no live capture or performance proof'];
    fixture.capture.workload.description = 'Saved synthetic one-function fixture; source indexed but never executed';
    const options = fixture.options;
    fixture.options = () => ({ ...options(), semanticContext: { repoRoot, store, manifest },
      sourceCandidates: [{ sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, targets }] });
    return fixture;
  } catch (error) { await fixture.cleanup(); throw error; }
};
