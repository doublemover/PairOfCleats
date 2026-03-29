#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { copyFixtureToTemp } from '../../helpers/fixtures.js';
import { resolveIndexDirFromBuildResult } from '../../helpers/index-build-output.js';
import { repoRoot } from '../../helpers/root.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const ROOT = repoRoot();
const BUILD_INDEX = path.join(ROOT, 'build_index.js');

const buildCallSitesFixture = async ({
  fixtureName,
  fixturePrefix,
  files = [],
  testConfig,
  label
}) => {
  const fixtureRoot = await copyFixtureToTemp(fixtureName, { prefix: fixturePrefix });
  const fixtureParent = path.dirname(fixtureRoot);
  const cacheRoot = await makeTempDir(`pairofcleats-cache-${label}-`);

  try {
    for (const [relPath, contents] of files) {
      const absolutePath = path.join(fixtureRoot, relPath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, contents, 'utf8');
    }

    const env = applyTestEnv({
      cacheRoot,
      embeddings: 'stub',
      testConfig,
      extraEnv: {
        PAIROFCLEATS_WORKER_POOL: 'off'
      },
      syncProcess: false
    });

    const result = spawnSync(
      process.execPath,
      [BUILD_INDEX, '--stub-embeddings', '--repo', fixtureRoot, '--stage', 'stage2', '--mode', 'code'],
      { cwd: fixtureRoot, env, encoding: 'utf8' }
    );

    if (result.status !== 0) {
      if (result.stdout) console.error(result.stdout);
      if (result.stderr) console.error(result.stderr);
      assert.fail(`build_index.js failed (${label}) with status ${result.status}`);
    }

    const userConfig = loadUserConfig(fixtureRoot);
    const codeDir = resolveIndexDirFromBuildResult(fixtureRoot, userConfig, result, { mode: 'code' });
    return { fixtureParent, cacheRoot, codeDir };
  } catch (error) {
    await rmDirRecursive(cacheRoot);
    await rmDirRecursive(fixtureParent);
    throw error;
  }
};

const readManifestPieces = async (codeDir) => {
  const manifestPath = path.join(codeDir, 'pieces', 'manifest.json');
  const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const fields = raw?.fields && typeof raw.fields === 'object' ? raw.fields : raw;
  return Array.isArray(fields?.pieces) ? fields.pieces : [];
};

const readCallSiteLines = async (codeDir) => {
  const callSites = await loadJsonArrayArtifact(codeDir, 'call_sites', { strict: true });
  assert.ok(Array.isArray(callSites) && callSites.length > 0, 'fixture must emit call_sites rows');
  return callSites.map((row) => JSON.stringify(row));
};

const cases = [
  {
    name: 'call-free repositories still emit an empty call_sites artifact',
    async run() {
      const testConfig = {
        sqlite: { enabled: false },
        indexing: {
          embeddings: { enabled: false },
          artifactCompression: { enabled: false },
          riskInterprocedural: { enabled: true }
        }
      };
      const resources = await buildCallSitesFixture({
        fixtureName: 'empty',
        fixturePrefix: 'pairofcleats-call-sites-empty-',
        files: [['index.js', 'const env = process.env.SECRET;\n']],
        testConfig,
        label: 'call-sites-empty'
      });

      try {
        const callSites = await loadJsonArrayArtifact(resources.codeDir, 'call_sites', { strict: true });
        assert.ok(Array.isArray(callSites));
        assert.equal(callSites.length, 0);
      } finally {
        await rmDirRecursive(resources.cacheRoot);
        await rmDirRecursive(resources.fixtureParent);
      }
    }
  },
  {
    name: 'emitArtifacts=none suppresses call_sites pieces',
    async run() {
      const testConfig = {
        sqlite: { enabled: false },
        indexing: {
          embeddings: { enabled: false },
          artifactCompression: { enabled: false },
          riskInterprocedural: { enabled: true, emitArtifacts: 'none' }
        }
      };
      const resources = await buildCallSitesFixture({
        fixtureName: 'call-sites-determinism',
        fixturePrefix: 'pairofcleats-call-sites-none-',
        testConfig,
        label: 'call-sites-none'
      });

      try {
        const names = (await readManifestPieces(resources.codeDir)).map((piece) => piece?.name).filter(Boolean);
        assert.ok(!names.includes('call_sites'));
        assert.ok(!names.includes('call_sites_meta'));
      } finally {
        await rmDirRecursive(resources.cacheRoot);
        await rmDirRecursive(resources.fixtureParent);
      }
    }
  },
  {
    name: 'call_sites artifacts are deterministic across clean rebuilds',
    async run() {
      const testConfig = {
        sqlite: { enabled: false },
        indexing: {
          embeddings: { enabled: false },
          artifactCompression: { enabled: false }
        }
      };
      const first = await buildCallSitesFixture({
        fixtureName: 'call-sites-determinism',
        fixturePrefix: 'pairofcleats-determinism-first-',
        testConfig,
        label: 'call-sites-first'
      });
      const second = await buildCallSitesFixture({
        fixtureName: 'call-sites-determinism',
        fixturePrefix: 'pairofcleats-determinism-second-',
        testConfig,
        label: 'call-sites-second'
      });

      try {
        assert.deepEqual(await readCallSiteLines(first.codeDir), await readCallSiteLines(second.codeDir));
      } finally {
        await rmDirRecursive(first.cacheRoot);
        await rmDirRecursive(first.fixtureParent);
        await rmDirRecursive(second.cacheRoot);
        await rmDirRecursive(second.fixtureParent);
      }
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('call_sites contract matrix test passed');
