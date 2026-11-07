#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { getIndexDir, getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { toRealPathSync } from '../../src/workspace/identity.js';
import { buildIndexSignature } from '../../src/retrieval/index-cache.js';
import { sha1 } from '../../src/shared/hash.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { createCompatibilityIndex } from '../helpers/index-compatibility-fixture.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-retained-workspace-modes-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
const repoRoot = path.join(root, 'selected project');
await fs.mkdir(repoRoot);
const workspacePath = path.join(root, 'workspace.jsonc');
await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './selected project' }] }));
const workspace = loadWorkspaceConfig(workspacePath);
const cache = getRepoCacheRoot(repoRoot);
const old = path.join(cache, 'builds', 'old');
const next = path.join(cache, 'builds', 'next');
const pointerPath = path.join(cache, 'builds', 'current.json');
const writePointer = payload => fs.writeFile(pointerPath, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  buildId: 'next', buildRoot: next, ...payload }));
try {
  for (const mode of ['code', 'prose']) {
    await createCompatibilityIndex(old, { mode, compatibilityKey: `retained-${mode}` });
    await createCompatibilityIndex(next, { mode, compatibilityKey: `new-${mode}` });
  }
  for (const promoted of ['code', 'prose']) {
    const retained = promoted === 'code' ? 'prose' : 'code';
    for (const field of ['buildRootsByMode', 'buildRoots']) {
      await writePointer({ modes: [promoted], [field]: { [promoted]: next, [retained]: old } });
      const { manifest } = await generateWorkspaceManifest(workspace, { write: false });
      const entries = manifest.repos[0].indexes;
      assert.equal(entries[promoted].indexRoot, toRealPathSync(next));
      assert.equal(entries[retained].indexRoot, toRealPathSync(old));
      assert.equal(entries[retained].compatibilityKey, `retained-${retained}`, 'stale same-named primary artifacts cannot win');
      for (const mode of ['code', 'prose']) {
        assert.equal(entries[mode].indexDir, toRealPathSync(getIndexDir(repoRoot, mode)));
        assert.equal(entries[mode].indexSignatureHash, `is1-${sha1(await buildIndexSignature(entries[mode].indexDir))}`);
        assert.equal(entries[mode].availabilityReason, 'present');
      }
    }
  }
  await writePointer({ modes: ['code'] });
  let legacy = await generateWorkspaceManifest(workspace, { write: false });
  assert.equal(legacy.manifest.repos[0].indexes.prose.indexDir, toRealPathSync(getIndexDir(repoRoot, 'prose')),
    'legacy pointers retain the canonical marker-based per-mode fallback');
  await writePointer({ modes: ['code', 'prose'], buildRootsByMode: { code: next } });
  let result = await generateWorkspaceManifest(workspace, { write: false });
  assert.equal(result.manifest.repos[0].indexes.prose.indexRoot, null, 'an explicit mode map does not authorize omitted modes');
  assert.equal(result.manifest.repos[0].indexes.prose.availabilityReason, 'missing-index-dir');
  await writePointer({ modes: ['code', 'prose'], buildRootsByMode: { code: next, prose: path.join(root, 'outside-cache') } });
  result = await generateWorkspaceManifest(workspace, { write: false });
  assert.equal(result.manifest.repos[0].indexes.code.availabilityReason, 'present');
  assert.equal(result.manifest.repos[0].indexes.prose.indexRoot, null);
  assert.equal(result.manifest.repos[0].indexes.prose.availabilityReason, 'invalid-pointer');
  await writePointer({ modes: ['code'], buildRootsByMode: { code: next } });
  await fs.writeFile(path.join(next, 'index-code', 'index_state.json'), JSON.stringify({
    artifactSurfaceVersion: 'unsupported-fixture-format', compatibilityKey: 'do-not-admit-old-format'
  }));
  result = await generateWorkspaceManifest(workspace, { write: false });
  assert.equal(result.manifest.repos[0].indexes.code.availabilityReason, 'incompatible-format');
  assert.equal(result.manifest.repos[0].indexes.code.compatibilityKey, null);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Workspace mode inventory retains explicit generations and rejects unsupported mode authority.');
