import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, getRepoCacheRoot, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { runSemanticEnrichmentService } from '../../../src/semantic/enrichment.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { openRepositorySemanticControl } from '../../../src/index/semantic/build-frontier.js';
import { captureEnrichmentAuthority } from '../../../src/semantic/enrichment-authority.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { wasmModule } from '../../helpers/wasm-fixture.js';

const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-drain-owner-')));
const repoRoot = path.join(temp, 'repo'), cacheA = path.join(temp, 'cache-a'), cacheB = path.join(temp, 'cache-b');
const trusted = path.join(temp, 'trusted.json');
await fs.mkdir(repoRoot); await fs.writeFile(trusted, '{}');
await fs.writeFile(path.join(repoRoot, 'module.wasm'), wasmModule({ functions: [{ code: [0x20, 0] }], exports: [{ name: 'run', index: 0 }] }));
applyTestEnv({ cacheRoot: cacheA, embeddings: 'stub', testConfig: { indexing: { workerPool: { enabled: false },
  semantic: { enabled: true, profile: 'rich', enrichment: { bindings: 'off', localFlow: 'deferred', crossFileFlow: 'off' } },
  embeddings: { enabled: false }, typeInference: false, typeInferenceCrossFile: false,
  riskAnalysis: false, treeSitter: { enabled: false } } } });
const originalNow = Date.now;
let offset = 0;
Date.now = () => originalNow() + offset;
try {
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_CONFIG: trusted }, async () => {
    await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', incremental: true, 'stub-embeddings': true, 'scm-provider': 'none' });
    const configA = loadUserConfig(repoRoot), repoCache = getRepoCacheRoot(repoRoot, configA);
    const pointer = path.join(repoCache, 'builds', 'current.json'), initialPointer = await fs.readFile(pointer);
    const initial = await openPublishedSemanticStore({ repoRoot, indexDir: getIndexDir(repoRoot, 'code', configA) });
    const request = { schemaVersion: 1, repoRoot, generation: initial.manifest.generation,
      limits: { maxTasks: 4, maxBytes: 65536, maxMs: 5000, drainMaxMs: 15000 } };
    const plan = await runSemanticEnrichmentService({ request });
    assert.equal(plan.tasks.length, 1); assert.equal(plan.tasks[0].executable, true);
    const drain = { ...request, action: 'drain', taskIds: [plan.tasks[0].taskId] };
    let built = false;
    await assert.rejects(runSemanticEnrichmentService({ request: drain,
      userConfig: { ...configA, cache: { ...configA.cache, root: cacheB } },
      build: () => { built = true; throw new Error('Foreign injected authority must not reach the builder.'); } }),
    { code: 'ERR_SEMANTIC_ENRICHMENT_STALE', reason: 'enrichment-authority-changed' });
    assert.equal(built, false); await assert.rejects(fs.stat(cacheB), { code: 'ENOENT' });

    for (const phase of ['builder-entry', 'runtime-config']) {
      let switched = false;
      const switchOwner = () => {
        switched = true; writeFileSync(trusted, JSON.stringify({ cache: { root: cacheB } }));
      };
      try {
        await assert.rejects(runSemanticEnrichmentService({ request: drain,
          ...(phase === 'runtime-config' ? { userConfig: structuredClone(configA) } : {}),
          build: async (root, options) => {
            if (phase === 'builder-entry') switchOwner();
            return buildIndex(root, { ...options, log: line => {
              if (phase === 'runtime-config' && !switched && line.includes('auto policy resolved')) switchOwner();
            } });
          } }), error => {
          assert.equal(error.code, 'ERR_SEMANTIC_ENRICHMENT_STALE'); assert.equal(error.reason, 'enrichment-authority-changed');
          assert.match(error.details.expected, /^[a-f0-9]{64}$/); assert.match(error.details.actual, /^[a-f0-9]{64}$/);
          assert.equal(JSON.stringify(error.details).includes(cacheB), false, 'diagnostics contain identities, not private paths'); return true;
        });
        assert.equal(switched, true, 'the actual normal-builder admission barrier must be exercised');
        await assert.rejects(fs.stat(cacheB), { code: 'ENOENT' });
        assert.deepEqual(await fs.readFile(pointer), initialPointer);
      } finally { await fs.writeFile(trusted, '{}'); }
      const journals = await fs.readdir(path.join(repoCache, 'semantic-frontier', 'drains'));
      assert.equal(journals.length, 1);
      const journal = JSON.parse(await fs.readFile(path.join(repoCache, 'semantic-frontier', 'drains', journals[0])));
      assert.equal(journal.status, 'failed'); assert.equal(journal.newBuildRoot, null);
      const control = await openRepositorySemanticControl({ root: repoRoot, userConfig: configA });
      try {
        const row = control.getTask(plan.tasks[0].taskId);
        assert.notEqual(row.state, 'leased'); assert.equal(row.leaseOwner, null);
        // Advance only the declared retry clock between independent refusal
        // controls. This does not retry a fixture or change its deadline.
        const failure = typeof row.lastError === 'string' ? JSON.parse(row.lastError) : row.lastError;
        if (failure?.retryAt) offset = Math.max(offset, failure.retryAt - originalNow() + 1);
      } finally { control.close(); }
    }
    const authority = captureEnrichmentAuthority({ repoRoot, userConfig: configA });
    assert.throws(() => authority.verify({ root: repoRoot, userConfig: configA,
      repoCacheRoot: cacheB, buildRoot: path.join(cacheB, 'builds', 'fake'), buildId: 'fake' }), { code: 'ERR_SEMANTIC_ENRICHMENT_STALE' });
    const result = await runSemanticEnrichmentService({ request: drain, userConfig: structuredClone(configA),
      build: async (root, options) => {
        // A supported thread budget is excluded by the content-policy owner.
        await fs.writeFile(trusted, JSON.stringify({ threads: 2 }));
        return buildIndex(root, options);
      } });
    assert.equal(result.status, 'published'); assert.equal(result.lineage.length, 1);
    const fresh = await openPublishedSemanticStore({ repoRoot, indexDir: getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot)),
      generation: result.publishedGeneration });
    assert.equal(fresh.manifest.completedTasks.length, 1);
    assert.deepEqual(fresh.manifest.partitions.filter(row => row.partitionId.startsWith('sy1:')).map(row => row.canonicalHash),
      initial.manifest.partitions.filter(row => row.partitionId.startsWith('sy1:')).map(row => row.canonicalHash));
    await assert.rejects(fs.stat(cacheB), { code: 'ENOENT' });
  });
} finally { Date.now = originalNow; await fs.rm(temp, { recursive: true, force: true }); }
console.log('Normal semantic drains reject cache-owner changes before builder/runtime mutation and preserve admitted A-to-A publication.');
