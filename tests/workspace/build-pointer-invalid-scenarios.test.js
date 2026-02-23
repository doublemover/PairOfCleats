#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import {
  createWorkspaceFixture,
  removeWorkspaceFixture,
  writeIndexArtifacts
} from '../helpers/workspace-fixture.js';

const readManifest = async (workspacePath) => {
  const workspaceConfig = loadWorkspaceConfig(workspacePath);
  const { manifest } = await generateWorkspaceManifest(workspaceConfig, { write: false });
  return manifest;
};

const hasInvalidPointerWarning = (manifest, expectedSnippet = null) => (
  Array.isArray(manifest?.diagnostics?.warnings)
  && manifest.diagnostics.warnings.some((entry) => (
    entry?.code === 'WARN_WORKSPACE_INVALID_BUILD_POINTER'
    && (
      !expectedSnippet
      || String(entry?.message || '').includes(expectedSnippet)
    )
  ))
);

const scenarios = [
  {
    name: 'absolute-buildid-points-outside-cache',
    prefix: 'pairofcleats-workspace-buildid-absolute-',
    setup: async ({ tempRoot, repoCacheRoot }) => {
      const externalBuildRoot = path.join(tempRoot, 'external-build');
      await writeIndexArtifacts({
        buildRoot: externalBuildRoot,
        compatibilityKey: 'compat-external'
      });
      const buildsRoot = path.join(repoCacheRoot, 'builds');
      await fs.mkdir(buildsRoot, { recursive: true });
      await fs.writeFile(path.join(buildsRoot, 'current.json'), JSON.stringify({
        buildId: externalBuildRoot,
        modes: ['code']
      }), 'utf8');
    },
    verify: (manifest) => {
      const repo = manifest.repos[0];
      assert.equal(repo.build.parseOk, true, 'current.json should parse');
      assert.equal(repo.build.buildRoot, null, 'absolute buildId should be treated as invalid pointer');
      assert.equal(repo.indexes.code.availabilityReason, 'invalid-pointer');
      assert.equal(repo.indexes.code.indexSignatureHash, null, 'invalid pointer should not use external index signatures');
      assert.equal(
        hasInvalidPointerWarning(manifest, 'buildId points outside repo cache'),
        true,
        'expected invalid absolute buildId warning'
      );
    }
  },
  {
    name: 'traversal-buildid-escapes-cache',
    prefix: 'pairofcleats-workspace-buildid-traversal-',
    setup: async ({ tempRoot, repoCacheRoot }) => {
      const buildsRoot = path.join(repoCacheRoot, 'builds');
      const externalBuildRoot = path.join(tempRoot, 'external-build');
      await writeIndexArtifacts({
        buildRoot: externalBuildRoot,
        compatibilityKey: 'compat-external'
      });
      await fs.mkdir(buildsRoot, { recursive: true });
      const escapedBuildId = path.relative(buildsRoot, externalBuildRoot);
      await fs.writeFile(path.join(buildsRoot, 'current.json'), JSON.stringify({
        buildId: escapedBuildId,
        modes: ['code']
      }), 'utf8');
    },
    verify: (manifest) => {
      const repo = manifest.repos[0];
      assert.equal(repo.build.parseOk, true, 'current.json should parse');
      assert.equal(repo.build.buildRoot, null, 'escaped buildId should be treated as invalid pointer');
      assert.equal(repo.indexes.code.availabilityReason, 'invalid-pointer');
      assert.equal(repo.indexes.code.present, false, 'invalid pointer should not load external index directories');
      assert.equal(repo.indexes.code.indexSignatureHash, null, 'invalid pointer should not compute external signatures');
      assert.equal(
        hasInvalidPointerWarning(manifest, 'buildId points outside repo cache'),
        true,
        'expected invalid buildId pointer warning'
      );
    }
  },
  {
    name: 'unresolved-buildroot-is-invalid',
    prefix: 'pairofcleats-workspace-unresolved-buildroot-',
    setup: async ({ tempRoot, repoCacheRoot }) => {
      const externalBuildRoot = path.join(tempRoot, 'external-build');
      await writeIndexArtifacts({
        buildRoot: externalBuildRoot,
        compatibilityKey: 'compat-external'
      });
      const localBuildRoot = path.join(repoCacheRoot, 'builds', 'build-external');
      await writeIndexArtifacts({
        buildRoot: localBuildRoot,
        compatibilityKey: 'compat-local'
      });
      const buildsRoot = path.join(repoCacheRoot, 'builds');
      await fs.mkdir(buildsRoot, { recursive: true });
      await fs.writeFile(path.join(buildsRoot, 'current.json'), JSON.stringify({
        buildId: 'build-external',
        buildRoot: externalBuildRoot
      }), 'utf8');
    },
    verify: (manifest) => {
      const repo = manifest.repos[0];
      assert.equal(repo.build.parseOk, true, 'current.json should parse');
      assert.equal(repo.build.buildRoot, null, 'unresolved buildRoot should be treated as invalid');
      assert.equal(repo.indexes.code.availabilityReason, 'invalid-pointer');
      assert.equal(repo.indexes.code.indexSignatureHash, null, 'invalid build pointer should not load external index signatures');
      assert.equal(repo.indexes.code.present, false, 'invalid pointer should not fall back to same-buildId local indexes');
      assert.equal(
        hasInvalidPointerWarning(manifest),
        true,
        'expected unresolved buildRoot warning'
      );
    }
  },
  {
    name: 'malformed-current-json-treated-missing',
    prefix: 'pairofcleats-workspace-invalid-pointer-',
    setup: async ({ repoCacheRoot }) => {
      const buildRoot = path.join(repoCacheRoot, 'builds', 'build-1');
      await writeIndexArtifacts({
        buildRoot,
        compatibilityKey: 'compat-a'
      });
      const buildsRoot = path.join(repoCacheRoot, 'builds');
      await fs.mkdir(buildsRoot, { recursive: true });
      await fs.writeFile(path.join(buildsRoot, 'current.json'), '{invalid json', 'utf8');
    },
    verify: (manifest) => {
      const repo = manifest.repos[0];
      const codeMode = repo.indexes.code;
      assert.equal(repo.build.currentJsonExists, true, 'current.json should be detected');
      assert.equal(repo.build.parseOk, false, 'invalid current.json should be treated as missing pointer');
      assert.equal(repo.build.buildId, null, 'invalid pointer should clear buildId');
      assert.equal(codeMode.availabilityReason, 'invalid-pointer');
      assert.equal(codeMode.indexSignatureHash, null, 'invalid pointer should not preserve stale index signatures');
    }
  }
];

for (const scenario of scenarios) {
  const fixture = await createWorkspaceFixture(scenario.prefix);
  try {
    await scenario.setup(fixture);
    const manifest = await readManifest(fixture.workspacePath);
    scenario.verify(manifest);
  } finally {
    await removeWorkspaceFixture(fixture.tempRoot);
  }
}

console.log('workspace invalid build pointer scenarios test passed');
