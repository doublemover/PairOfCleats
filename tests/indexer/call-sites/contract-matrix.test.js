#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { resolveIndexDirFromBuildResult } from '../../helpers/index-build-output.js';
import { repoRoot } from '../../helpers/root.js';
import { runNode } from '../../helpers/run-node.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const ROOT = repoRoot();
const BUILD_INDEX = path.join(ROOT, 'build_index.js');

const CALL_SITES_FIXTURES = Object.freeze({
  empty: [['index.js', 'const env = process.env.SECRET;\n']],
  determinism: [[
    'index.js',
    `function alpha() {
  return 1;
}

function beta() {
  return alpha();
}

class Widget {
  constructor() {
    this.value = beta();
  }

  method() {
    return alpha();
  }
}

const widget = new Widget();
widget.method();
`
  ]]
});

const buildCallSitesFixture = async ({
  fixturePrefix,
  fixtureKey = 'empty',
  files = null,
  testConfig,
  label
}) => {
  const fixtureRoot = await makeTempDir(fixturePrefix);
  const cacheRoot = await makeTempDir(`pairofcleats-cache-${label}-`);
  const effectiveFiles = Array.isArray(files)
    ? files
    : (CALL_SITES_FIXTURES[fixtureKey] || []);

  try {
    for (const [relPath, contents] of effectiveFiles) {
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

    const result = runNode(
      [
        BUILD_INDEX,
        '--scm-provider',
        'none',
        '--stub-embeddings',
        '--repo',
        fixtureRoot,
        '--stage',
        'stage2',
        '--mode',
        'code',
        '--no-sqlite'
      ],
      `call_sites build (${label})`,
      fixtureRoot,
      env,
      { stdio: 'pipe', allowFailure: true }
    );

    if (result.status !== 0) {
      if (result.stdout) console.error(result.stdout);
      if (result.stderr) console.error(result.stderr);
      assert.fail(`build_index.js failed (${label}) with status ${result.status}`);
    }

    const userConfig = loadUserConfig(fixtureRoot);
    const codeDir = resolveIndexDirFromBuildResult(fixtureRoot, userConfig, result, { mode: 'code' });
    return { fixtureRoot, cacheRoot, codeDir };
  } catch (error) {
    await rmDirRecursive(cacheRoot);
    await rmDirRecursive(fixtureRoot);
    throw error;
  }
};

const readManifestPieces = async (codeDir) => {
  const manifestPath = path.join(codeDir, 'pieces', 'manifest.json');
  const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const fields = raw?.fields && typeof raw.fields === 'object' ? raw.fields : raw;
  return Array.isArray(fields?.pieces) ? fields.pieces : [];
};

const readCallSites = async (codeDir) => {
  const callSites = await loadJsonArrayArtifact(codeDir, 'call_sites', { strict: true });
  assert.ok(Array.isArray(callSites) && callSites.length > 0, 'fixture must emit call_sites rows');
  return callSites;
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
          typeInference: false,
          typeInferenceCrossFile: false,
          riskAnalysisCrossFile: false,
          riskInterprocedural: { enabled: true }
        }
      };
      const resources = await buildCallSitesFixture({
        fixturePrefix: 'pairofcleats-call-sites-empty-',
        fixtureKey: 'empty',
        testConfig,
        label: 'call-sites-empty'
      });

      try {
        const callSites = await loadJsonArrayArtifact(resources.codeDir, 'call_sites', { strict: true });
        assert.ok(Array.isArray(callSites));
        assert.equal(callSites.length, 0);
      } finally {
        await rmDirRecursive(resources.cacheRoot);
        await rmDirRecursive(resources.fixtureRoot);
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
          typeInference: false,
          typeInferenceCrossFile: false,
          riskAnalysisCrossFile: false,
          riskInterprocedural: { enabled: true, emitArtifacts: 'none' }
        }
      };
      const resources = await buildCallSitesFixture({
        fixturePrefix: 'pairofcleats-call-sites-none-',
        fixtureKey: 'determinism',
        testConfig,
        label: 'call-sites-none'
      });

      try {
        const names = (await readManifestPieces(resources.codeDir)).map((piece) => piece?.name).filter(Boolean);
        assert.ok(!names.includes('call_sites'));
        assert.ok(!names.includes('call_sites_meta'));
      } finally {
        await rmDirRecursive(resources.cacheRoot);
        await rmDirRecursive(resources.fixtureRoot);
      }
    }
  },
  {
    name: 'call_sites artifacts preserve deterministic fixture call evidence',
    async run() {
      const testConfig = {
        sqlite: { enabled: false },
        indexing: {
          embeddings: { enabled: false },
          artifactCompression: { enabled: false },
          typeInference: false,
          typeInferenceCrossFile: false,
          riskAnalysisCrossFile: false
        }
      };
      const resources = await buildCallSitesFixture({
        fixturePrefix: 'pairofcleats-determinism-first-',
        fixtureKey: 'determinism',
        testConfig,
        label: 'call-sites-first'
      });

      try {
        const callSites = await readCallSites(resources.codeDir);
        const callSiteText = callSites.map((row) => JSON.stringify(row)).join('\n');
        assert.match(callSiteText, /\balpha\b/, 'expected alpha call evidence');
        assert.match(callSiteText, /\bbeta\b/, 'expected beta call evidence');
      } finally {
        await rmDirRecursive(resources.cacheRoot);
        await rmDirRecursive(resources.fixtureRoot);
      }
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('call_sites contract matrix test passed');
