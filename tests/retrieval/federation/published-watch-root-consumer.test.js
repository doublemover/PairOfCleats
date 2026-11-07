import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { search } from '../../../src/integrations/core/search.js';
import { parseSearchArgs } from '../../../src/retrieval/cli-args.js';
import { createWatchAttemptManager } from '../../../src/index/build/watch/attempts.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { writeArtifactPublicationRecord, writeArtifactPublicationValidationReport } from '../../../src/index/build/artifact-publication.js';
import { captureAdmittedSearchGeneration, INTERNAL_ADMITTED_GENERATION } from '../../../src/index/as-of.js';
import { buildPinnedFederatedModePlans } from '../../../src/retrieval/federation/generation.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../../src/workspace/manifest.js';
import { loadUserConfig } from '../../../src/shared/dict-utils.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';
import { createSettledWatchAttempt } from '../../helpers/watch-attempts.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { writeFederationRepoFixture } from './repo-fixture.js';

const { dir } = await prepareIsolatedTestCacheDir('federated-published-watch-root');
const cacheRoot = path.join(dir, 'cache'), repoRoot = path.join(dir, 'repo');
applyTestEnv({ cacheRoot, embeddings: 'off' });
try {
  const ordinary = await writeFederationRepoFixture({ repoRoot, cacheRoot, buildId: 'retained-prose', modes: ['prose', 'extracted-prose'] });
  const config = loadUserConfig(repoRoot);
  const publish = async (buildRoot, buildId, mode, name) => {
    const outDir = await createCompatibilityIndex(buildRoot, { mode, buildId, compatibilityKey: 'watch-compatible' });
    await fs.writeFile(path.join(outDir, 'chunk_meta.json'), JSON.stringify([{ id: 0, file: `${mode}.js`,
      chunkUid: `${buildId}:${mode}`, name, kind: 'FunctionDeclaration', start: 0, end: 5, tokens: ['alpha'] }]));
    const manifestPath = path.join(outDir, 'pieces/manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    Object.assign(manifest, { mode, stage: 'stage2', buildId });
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const publicationValidation = await writeArtifactPublicationValidationReport({ buildRoot, outDir, mode, buildId,
      pieceEntries: manifest.pieces, manifestPath });
    assert.equal(publicationValidation.payload.ok, true);
    await writeArtifactPublicationRecord({ buildRoot, outDir, mode, buildId, stage: 'stage2',
      pieceEntries: manifest.pieces, manifestPath, publicationValidation });
  };
  for (const mode of ['prose', 'extracted-prose']) await publish(ordinary.buildRoot, ordinary.buildId, mode, 'retained-prose');
  await promoteBuild({ repoRoot, userConfig: config, buildId: ordinary.buildId, buildRoot: ordinary.buildRoot,
    stage: 'stage2', modes: ['prose', 'extracted-prose'] });
  const manager = createWatchAttemptManager({ repoRoot, userConfig: config });
  const attempt = await createSettledWatchAttempt(manager, repoRoot, config);
  await publish(attempt.buildRoot, attempt.buildId, 'code', 'published-watch-code');
  await promoteBuild({ repoRoot, userConfig: config, buildId: attempt.buildId, buildRoot: attempt.buildRoot,
    stage: 'stage2', modes: ['code'] });
  const pointerPath = path.join(ordinary.repoCacheRoot, 'builds/current.json');
  const pointerTime = new Date('2026-10-29T12:00:00.000Z');
  await fs.utimes(pointerPath, pointerTime, pointerTime);
  const pointerBytes = await fs.readFile(pointerPath), pointerStat = await fs.stat(pointerPath);
  const current = JSON.parse(pointerBytes);
  assert.ok(current.buildRootsByMode.code.startsWith('builds/attempts/'));
  assert.equal(path.basename(current.buildRootsByMode.prose), ordinary.buildId);
  const workspacePath = path.join(dir, 'workspace.json');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './repo' }] }));
  const workspace = loadWorkspaceConfig(workspacePath);
  const admitted = (await generateWorkspaceManifest(workspace, { write: false })).manifest;
  const member = admitted.repos[0];
  const restore = async () => {
    await fs.writeFile(pointerPath, pointerBytes); await fs.utimes(pointerPath, pointerStat.atime, pointerStat.mtime);
  };
  const replacementRoot = path.join(ordinary.repoCacheRoot, 'builds', 'replacement-code');
  await publish(replacementRoot, 'replacement-code', 'code', 'replacement-code');
  for (const shape of ['ranked', 'enumeration', 'host-ranked']) {
    const observed = [];
    const request = { workspacePath, strict: true, ...(shape === 'enumeration' ? {} : { query: 'alpha' }),
      search: { mode: shape === 'enumeration' ? 'code' : 'both', backend: 'memory', top: 5,
        ...(shape === 'enumeration' ? { type: 'FunctionDeclaration' } : {}) } };
    const context = { searchPolicyId: `watch-root:${shape}`, searchFn: async (root, options) => {
      await promoteBuild({ repoRoot, userConfig: config, buildId: 'replacement-code', buildRoot: replacementRoot,
        stage: 'stage2', modes: ['code'] });
      try {
        const value = await search(root, options);
        const childMode = parseSearchArgs(options.args).mode;
        const requested = childMode === 'prose' ? ['prose', 'extractedProse'] : ['code'];
        for (const mode of requested) {
          const freshness = value.retrieval.freshness.byMode[mode];
          assert.ok(freshness, `the actual ${childMode} child reports its selected ${mode} source`);
          const expected = mode === 'code' ? attempt.buildRoot : ordinary.buildRoot;
          assert.equal(toRealPathSync(freshness.activeBuildRoot), toRealPathSync(expected));
        }
        observed.push(value); return value;
      } finally { await restore(); }
    } };
    if (shape === 'host-ranked') context.resolveRepoCaches = async () => ({ buildId: member.build.buildId,
      activeBuildRoot: member.build.activeRoot, buildGenerationKey: member.build.generationKey });
    const value = await runFederatedSearch(request, context);
    assert.deepEqual(value.code.map(hit => hit.name), ['published-watch-code']);
    if (shape !== 'enumeration') {
      assert.deepEqual(value.prose.map(hit => hit.name), ['retained-prose']);
      assert.deepEqual(value.extractedProse.map(hit => hit.name), ['retained-prose']);
      assert.deepEqual(await runFederatedSearch(request, context), value);
      assert.equal(observed.length, 2, 'warm outer result cache reuses only admitted source identities');
    } else assert.equal(observed.length, 1);
    assert.equal((await generateWorkspaceManifest(workspace, { write: false })).manifest.manifestHash, admitted.manifestHash);
  }
  for (const root of [path.join(dir, 'outside-cache'), path.join(ordinary.repoCacheRoot, 'builds', 'unpublished')]) {
    const forged = { ...member, indexes: { ...member.indexes, code: { ...member.indexes.code, indexRoot: root } } };
    assert.throws(() => buildPinnedFederatedModePlans({ modes: ['code'], manifestRepo: forged, args: [] }), { code: 'INVALID_REQUEST' });
  }
  await assert.rejects(search(repoRoot, { query: 'alpha', args: ['--backend', 'memory', '--mode', 'code'],
    [INTERNAL_ADMITTED_GENERATION]: Object.freeze({}) }), { code: 'INVALID_REQUEST' });
  const token = captureAdmittedSearchGeneration({ repoRoot, requestedModes: ['code'],
    expectedRootsByMode: { code: member.indexes.code.indexRoot } });
  await assert.rejects(search(repoRoot, { query: 'alpha', args: ['--as-of', `build:${ordinary.buildId}`],
    [INTERNAL_ADMITTED_GENERATION]: token }), { code: 'INVALID_REQUEST' });
  await assert.rejects(search(repoRoot, { query: 'alpha', args: ['--as-of', `build:attempts/${attempt.buildId}`] }),
    { code: 'INVALID_REQUEST' }, 'internal watch binding does not expand the public historical path grammar');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Real promoted watch attempts retain split roots through ranked/enumeration races, host caches and warm reuse.');
