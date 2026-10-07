#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { applyTestEnv } from '../helpers/test-env.js';
import { runNode } from '../helpers/run-node.js';
import { createWorkspaceFixture, removeWorkspaceFixture, writeIndexArtifacts } from '../helpers/workspace-fixture.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { toRealPathSync } from '../../src/workspace/identity.js';
import { computeManifestHash, generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';

applyTestEnv();

const root = process.cwd();
const GENERATED_AT = '2026-02-12T00:00:00.000Z';

const readManifest = async (workspacePath) => {
  const workspaceConfig = loadWorkspaceConfig(workspacePath);
  const { manifest } = await generateWorkspaceManifest(workspaceConfig, { write: false });
  return manifest;
};

const generateManifestFromWorkspace = async (workspacePath) => {
  const workspaceConfig = loadWorkspaceConfig(workspacePath);
  return await generateWorkspaceManifest(workspaceConfig, { write: false, generatedAt: GENERATED_AT });
};

const hasInvalidPointerWarning = (manifest, expectedSnippet = null) => (
  Array.isArray(manifest?.diagnostics?.warnings)
  && manifest.diagnostics.warnings.some((entry) => (
    entry?.code === 'WARN_WORKSPACE_INVALID_BUILD_POINTER'
    && (!expectedSnippet || String(entry?.message || '').includes(expectedSnippet))
  ))
);

const writeRepoConfig = async (repoRoot, cacheRoot) => {
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');
};

const writeCurrentBuildMetadata = async (repoCacheRoot, payload, { raw = false } = {}) => {
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  await fs.mkdir(buildsRoot, { recursive: true });
  await fs.writeFile(path.join(buildsRoot, 'current.json'), raw ? payload : JSON.stringify(payload), 'utf8');
  return buildsRoot;
};

const assertInvalidBuildPointer = (manifest, expected = {}) => {
  const repo = manifest.repos[0];
  if (Object.hasOwn(expected, 'currentJsonExists')) {
    assert.equal(repo.build.currentJsonExists, expected.currentJsonExists);
  }
  if (Object.hasOwn(expected, 'parseOk')) {
    assert.equal(repo.build.parseOk, expected.parseOk);
  }
  if (Object.hasOwn(expected, 'buildId')) {
    assert.equal(repo.build.buildId, expected.buildId);
  }
  if (Object.hasOwn(expected, 'buildRoot')) {
    assert.equal(repo.build.buildRoot, expected.buildRoot);
  }
  assert.equal(repo.indexes.code.availabilityReason, 'invalid-pointer');
  assert.equal(repo.indexes.code.indexSignatureHash, null);
  if (Object.hasOwn(expected, 'present')) {
    assert.equal(repo.indexes.code.present, expected.present);
  }
  if (expected.warning === true || Object.hasOwn(expected, 'warningSnippet')) {
    assert.equal(hasInvalidPointerWarning(manifest, expected.warningSnippet), true);
  }
};

const runBuildPointerScenarios = async () => {
  const scenarios = [
    {
      prefix: 'workspace-buildid-absolute',
      async setup({ tempRoot, repoCacheRoot }) {
        const externalBuildRoot = path.join(tempRoot, 'external-build');
        await writeIndexArtifacts({ buildRoot: externalBuildRoot, compatibilityKey: 'compat-external' });
        await writeCurrentBuildMetadata(repoCacheRoot, {
          buildId: externalBuildRoot,
          modes: ['code']
        });
      },
      verify(manifest) {
        assertInvalidBuildPointer(manifest, {
          parseOk: true,
          buildRoot: null,
          warningSnippet: 'buildId points outside repo cache'
        });
      }
    },
    {
      prefix: 'workspace-buildid-traversal',
      async setup({ tempRoot, repoCacheRoot }) {
        const buildsRoot = path.join(repoCacheRoot, 'builds');
        const externalBuildRoot = path.join(tempRoot, 'external-build');
        await writeIndexArtifacts({ buildRoot: externalBuildRoot, compatibilityKey: 'compat-external' });
        const escapedBuildId = path.relative(buildsRoot, externalBuildRoot);
        await writeCurrentBuildMetadata(repoCacheRoot, {
          buildId: escapedBuildId,
          modes: ['code']
        });
      },
      verify(manifest) {
        assertInvalidBuildPointer(manifest, {
          parseOk: true,
          buildRoot: null,
          present: false,
          warningSnippet: 'buildId points outside repo cache'
        });
      }
    },
    {
      prefix: 'workspace-unresolved-buildroot',
      async setup({ tempRoot, repoCacheRoot }) {
        const externalBuildRoot = path.join(tempRoot, 'external-build');
        await writeIndexArtifacts({ buildRoot: externalBuildRoot, compatibilityKey: 'compat-external' });
        const localBuildRoot = path.join(repoCacheRoot, 'builds', 'build-external');
        await writeIndexArtifacts({ buildRoot: localBuildRoot, compatibilityKey: 'compat-local' });
        await writeCurrentBuildMetadata(repoCacheRoot, {
          buildId: 'build-external',
          buildRoot: externalBuildRoot
        });
      },
      verify(manifest) {
        assertInvalidBuildPointer(manifest, {
          parseOk: true,
          buildRoot: null,
          present: false,
          warning: true
        });
      }
    },
    {
      prefix: 'workspace-invalid-pointer-json',
      async setup({ repoCacheRoot }) {
        const buildRoot = path.join(repoCacheRoot, 'builds', 'build-1');
        await writeIndexArtifacts({ buildRoot, compatibilityKey: 'compat-a' });
        await writeCurrentBuildMetadata(repoCacheRoot, '{invalid json', { raw: true });
      },
      verify(manifest) {
        assertInvalidBuildPointer(manifest, {
          currentJsonExists: true,
          parseOk: false,
          buildId: null
        });
      }
    },
    {
      prefix: 'workspace-buildid-prefers-builds-root',
      async setup({ repoCacheRoot }) {
        const buildId = 'build-1';
        const buildsRoot = path.join(repoCacheRoot, 'builds');
        const canonicalBuildRoot = path.join(buildsRoot, buildId);
        await writeIndexArtifacts({ buildRoot: canonicalBuildRoot, compatibilityKey: 'compat-builds' });
        const rogueBuildRoot = path.join(repoCacheRoot, buildId);
        await writeIndexArtifacts({ buildRoot: rogueBuildRoot, compatibilityKey: 'compat-rogue' });
        await writeCurrentBuildMetadata(repoCacheRoot, {
          buildId,
          modes: ['code']
        });
      },
      verify(manifest, { repoCacheRoot }) {
        const repo = manifest.repos[0];
        const canonicalBuildRoot = path.join(repoCacheRoot, 'builds', 'build-1');
        const canonicalIndexDir = path.join(canonicalBuildRoot, 'index-code');
        assert.equal(repo.build.buildRoot, toRealPathSync(canonicalBuildRoot));
        assert.equal(repo.indexes.code.indexDir, toRealPathSync(canonicalIndexDir));
        assert.equal(repo.indexes.code.compatibilityKey, 'compat-builds');
      }
    }
  ];

  for (const scenario of scenarios) {
    const fixture = await createWorkspaceFixture(scenario.prefix);
    try {
      await scenario.setup(fixture);
      const manifest = await readManifest(fixture.workspacePath);
      scenario.verify(manifest, fixture);
    } finally {
      await removeWorkspaceFixture(fixture.tempRoot);
    }
  }
};

const runIndexSignatureVariantCase = async () => {
  const { repoCacheRoot, workspacePath } = await createWorkspaceFixture('pairofcleats-workspace-signature-variants-');
  const buildRoot = path.join(repoCacheRoot, 'builds', 'build-1');
  const indexDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(path.join(indexDir, 'chunk_meta.parts'), { recursive: true });
  await fs.mkdir(path.join(indexDir, 'token_postings.shards'), { recursive: true });
  await fs.writeFile(path.join(indexDir, 'chunk_meta.meta.json'), '{"parts":1}', 'utf8');
  await fs.writeFile(path.join(indexDir, 'chunk_meta.parts', 'chunk_meta.part-00001.jsonl'), '{"id":1}\n', 'utf8');
  await fs.writeFile(path.join(indexDir, 'token_postings.meta.json'), '{"parts":1}', 'utf8');
  await fs.writeFile(path.join(indexDir, 'token_postings.shards', 'token_postings.part-00001.jsonl'), '{"token":"a"}\n', 'utf8');
  await writeCurrentBuildMetadata(repoCacheRoot, { buildId: 'build-1', buildRoot });

  const workspaceConfig = loadWorkspaceConfig(workspacePath);
  const first = await generateWorkspaceManifest(workspaceConfig, { write: false });
  const firstSignature = first.manifest.repos[0].indexes.code.indexSignatureHash;
  assert.ok(firstSignature && firstSignature.startsWith('is1-'));

  await fs.rm(path.join(indexDir, 'chunk_meta.parts'), { recursive: true, force: true });
  await fs.rm(path.join(indexDir, 'token_postings.shards'), { recursive: true, force: true });
  await fs.rm(path.join(indexDir, 'chunk_meta.meta.json'), { force: true });
  await fs.rm(path.join(indexDir, 'token_postings.meta.json'), { force: true });
  await fs.writeFile(path.join(indexDir, 'chunk_meta.jsonl'), '{"id":1}\n', 'utf8');
  await fs.writeFile(path.join(indexDir, 'token_postings.packed.bin'), 'packed', 'utf8');
  await fs.writeFile(path.join(indexDir, 'token_postings.packed.meta.json'), '{"rows":1}', 'utf8');

  const second = await generateWorkspaceManifest(workspaceConfig, { write: false });
  const secondSignature = second.manifest.repos[0].indexes.code.indexSignatureHash;
  assert.ok(secondSignature && secondSignature.startsWith('is1-'));
  assert.notEqual(firstSignature, secondSignature);
};

const runManifestDeterminismAndHashCase = async () => {
  {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-manifest-determinism-'));
    const cacheRoot = path.join(tempRoot, 'cache');
    const repoA = path.join(tempRoot, 'repo-a');
    const repoB = path.join(tempRoot, 'repo-b');
    const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

    const writeRepoBuild = async (repoRoot, buildId) => {
      const repoCacheRoot = getRepoCacheRoot(toRealPathSync(repoRoot));
      const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
      await writeIndexArtifacts({ buildRoot, compatibilityKey: `compat-${buildId}` });
      await writeCurrentBuildMetadata(repoCacheRoot, { buildId, buildRoot });
    };

    await writeRepoConfig(repoA, cacheRoot);
    await writeRepoConfig(repoB, cacheRoot);
    await writeRepoBuild(repoA, 'build-a');
    await writeRepoBuild(repoB, 'build-b');
    await fs.writeFile(workspacePath, `{
      "schemaVersion": 1,
      "cacheRoot": "./cache",
      "repos": [
        { "root": "./repo-b", "alias": "B" },
        { "root": "./repo-a", "alias": "A" }
      ]
    }`, 'utf8');

    const first = await generateManifestFromWorkspace(workspacePath);
    const second = await generateManifestFromWorkspace(workspacePath);
    assert.equal(first.manifestPath, second.manifestPath);
    assert.equal(stableStringify(first.manifest), stableStringify(second.manifest));
    const repoIds = first.manifest.repos.map((entry) => entry.repoId);
    assert.deepEqual(repoIds, repoIds.slice().sort());
  }

  {
    const { cacheRoot, repoCacheRoot, workspacePath } = await createWorkspaceFixture('pairofcleats-workspace-manifest-hash-');
    const buildRoot = path.join(repoCacheRoot, 'builds', 'build-1');
    const indexDir = path.join(buildRoot, 'index-code');
    await fs.mkdir(indexDir, { recursive: true });
    await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]', 'utf8');
    await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{"a":[1]}', 'utf8');
    await writeCurrentBuildMetadata(repoCacheRoot, { buildId: 'build-1', buildRoot });
    await fs.writeFile(workspacePath, `{
      "schemaVersion": 1,
      "cacheRoot": "./cache",
      "repos": [{ "root": "./repo", "alias": "initial" }]
    }`, 'utf8');

    const first = await generateManifestFromWorkspace(workspacePath);
    const firstSignature = first.manifest.repos[0].indexes.code.indexSignatureHash;
    await new Promise((resolve) => setTimeout(resolve, 25));
    await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{"a":[1,2,3]}', 'utf8');

    const second = await generateManifestFromWorkspace(workspacePath);
    const secondSignature = second.manifest.repos[0].indexes.code.indexSignatureHash;
    assert.notEqual(firstSignature, secondSignature);
    assert.notEqual(first.manifest.manifestHash, second.manifest.manifestHash);

    await fs.writeFile(workspacePath, `{
      "schemaVersion": 1,
      "cacheRoot": "./cache",
      "repos": [{ "root": "./repo", "alias": "renamed-only" }]
    }`, 'utf8');

    const third = await generateManifestFromWorkspace(workspacePath);
    assert.equal(second.manifest.manifestHash, third.manifest.manifestHash);

    const baseRepo = third.manifest.repos[0];
    const shiftedGenerationHash = computeManifestHash({
      ...third.manifest,
      repos: [{
        ...baseRepo,
        build: {
          ...baseRepo.build,
          activeRoot: path.join(cacheRoot, 'builds', 'build-1-shadow'),
          generationKey: 'wm-test-generation-shift'
        }
      }]
    });
    assert.notEqual(third.manifest.manifestHash, shiftedGenerationHash);
  }
};

const runCatalogJsonCase = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-catalog-json-'));
  const repoRoot = path.join(tempRoot, 'repo');
  const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
  const expectedFederationCacheRoot = path.resolve(tempRoot, 'workspace-cache');
  const toolPath = path.join(root, 'tools', 'workspace', 'catalog.js');

  await writeRepoConfig(repoRoot, path.join(tempRoot, 'repo-cache-root'));

  const repoCacheRoot = getRepoCacheRoot(toRealPathSync(repoRoot));
  const buildRoot = path.join(repoCacheRoot, 'builds', 'build-1');
  await writeIndexArtifacts({ buildRoot, compatibilityKey: 'compat-build-1' });
  await writeCurrentBuildMetadata(repoCacheRoot, { buildId: 'build-1', buildRoot });

  await fs.writeFile(workspacePath, `{
    "schemaVersion": 1,
    "name": "catalog fixture",
    "cacheRoot": "./workspace-cache",
    "repos": [
      { "root": "./repo", "alias": "sample" }
    ]
  }`, 'utf8');

  const run = runNode(
    [toolPath, '--workspace', workspacePath, '--json'],
    'workspace catalog manifest json',
    root,
    applyTestEnv({ syncProcess: false }),
    { stdio: 'pipe' }
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(toRealPathSync(payload.cacheRoots?.federationCacheRoot), toRealPathSync(expectedFederationCacheRoot));
  assert.equal(typeof payload.cacheRoots?.workspaceManifestPath, 'string');
  assert.ok(payload.cacheRoots.workspaceManifestPath.endsWith('.json'));
  assert.equal(payload.repos.length, 1);
  assert.ok(payload.repos[0].repoId.startsWith('repo-'));
  assert.ok(payload.repos[0]?.pointer);
  assert.equal(payload.repos[0]?.pointer?.buildId, 'build-1');
  assert.equal(payload.repos[0]?.pointer?.parseOk, true);
  assert.equal(typeof payload.repos[0]?.pointer?.currentJsonPath, 'string');
  assert.equal(toRealPathSync(payload.repos[0]?.repoCacheRoot), toRealPathSync(repoCacheRoot));
};

await runBuildPointerScenarios();
await runIndexSignatureVariantCase();
await runManifestDeterminismAndHashCase();
await runCatalogJsonCase();

console.log('workspace manifest contract matrix test passed');
