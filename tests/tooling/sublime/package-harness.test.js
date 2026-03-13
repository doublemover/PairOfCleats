#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { copyFixtureToTemp } from '../../helpers/fixtures.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();

const pythonPolicy = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'tooling', 'python-check.js'), '--json'],
  { encoding: 'utf8' }
);
if (pythonPolicy.status !== 0) {
  console.error('sublime-package-harness: required python toolchain is missing');
  if (pythonPolicy.stdout) console.error(pythonPolicy.stdout.trim());
  if (pythonPolicy.stderr) console.error(pythonPolicy.stderr.trim());
  process.exit(pythonPolicy.status ?? 1);
}

let pythonInfo = null;
try {
  pythonInfo = JSON.parse(pythonPolicy.stdout || '{}');
} catch {
  pythonInfo = null;
}
const python = pythonInfo?.python || process.env.PYTHON || 'python';
const script = path.join(root, 'tests', 'helpers', 'sublime', 'package_harness.py');
const fixtureRepo = await copyFixtureToTemp('sample', { prefix: 'pairofcleats-sublime-package-' });
const cacheRoot = (await prepareIsolatedTestCacheDir('sublime-package-harness', { root })).dir;
const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    sqlite: { use: false },
    indexing: {
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false,
      embeddings: {
        enabled: false,
        mode: 'off',
        lancedb: { enabled: false },
        hnsw: { enabled: false }
      }
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  },
  extraEnv: {
    PAIROFCLEATS_SUBLIME_TEST_NODE: process.execPath,
    PAIROFCLEATS_SUBLIME_TEST_CLI: path.join(root, 'bin', 'pairofcleats.js'),
    PAIROFCLEATS_SUBLIME_TEST_FIXTURE_REPO: fixtureRepo
  },
  syncProcess: false
});

const result = spawnSync(python, [script], {
  encoding: 'utf8',
  env,
});

if (result.status !== 0) {
  console.error('sublime-package-harness: python harness failed');
  if (result.stdout) console.error(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(result.status || 1);
}

console.log('sublime package harness test passed');
