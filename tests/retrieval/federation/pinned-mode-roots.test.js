import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { search as coreSearch } from '../../../src/integrations/core/search.js';
import { writeFederationRepoFixture } from './repo-fixture.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-pinned-mode-roots-'));
const cacheRoot = path.join(root, 'cache');
applyTestEnv({ cacheRoot, embeddings: 'off' });
try {
  const repoRoot = path.join(root, 'repo');
  const descriptors = {};
  for (const [buildId, modes] of [['code-generation', ['code']], ['prose-generation', ['prose', 'extracted-prose']]]) {
    const descriptor = await writeFederationRepoFixture({ repoRoot, cacheRoot, buildId, modes });
    descriptors[buildId] = descriptor;
    for (const mode of modes) {
      const indexDir = await createCompatibilityIndex(descriptor.buildRoot, { mode, compatibilityKey: 'compatible' });
      await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([{
        id: 0, chunkUid: `${buildId}:${mode}`, file: `${mode}.js`, name: buildId,
        kind: 'FunctionDeclaration', start: 0, end: 1, tokens: ['alpha'], text: 'alpha'
      }]));
    }
  }
  const pointerPath = path.join(descriptors['code-generation'].repoCacheRoot, 'builds', 'current.json');
  await fs.writeFile(pointerPath, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: 'prose-generation', buildRoot: descriptors['prose-generation'].buildRoot,
    buildRootsByMode: { code: descriptors['code-generation'].buildRoot,
      prose: descriptors['prose-generation'].buildRoot, 'extracted-prose': descriptors['prose-generation'].buildRoot },
    modes: ['code', 'prose', 'extracted-prose'] }));
  const workspacePath = path.join(root, 'workspace.json');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './repo' }] }));
  const calls = [];
  const searchFn = async (repo, options) => {
    calls.push({ mode: options.args[options.args.indexOf('--mode') + 1],
      asOf: options.args[options.args.indexOf('--as-of') + 1] });
    return coreSearch(repo, options);
  };
  const request = { workspacePath, query: 'alpha', strict: true, search: { mode: 'both', backend: 'memory' } };
  const response = await runFederatedSearch(request, { searchFn });
  assert.deepEqual(calls, [{ mode: 'code', asOf: 'build:code-generation' }, { mode: 'prose', asOf: 'build:prose-generation' }]);
  assert.equal(response.code[0].name, 'code-generation');
  assert.equal(response.prose[0].name, 'prose-generation');
  assert.equal(response.extractedProse[0].name, 'prose-generation');
  assert.equal(response.partialSuccess, false);
  assert.deepEqual(await runFederatedSearch(request, { searchFn }), response);
  assert.equal(calls.length, 2, 'the qualified mixed-root result is reusable without resolving current roots again');

  // Historical selectors preserve the caller's authority and cannot label a
  // missing historical mode with the latest workspace generation.
  await assert.rejects(runFederatedSearch({ ...request, search: { ...request.search, asOf: 'build:code-generation' } }),
    error => { assert.ok(['NO_INDEX', 'NOT_FOUND', 'INVALID_REQUEST'].includes(error.code)); return true; });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runFederatedSearch(request, { searchFn, signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(calls.length, 2);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Actual core federation pins mixed per-mode roots, preserves historical-selector authority, and reuses qualified warm results.');
