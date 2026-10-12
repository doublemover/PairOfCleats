#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();

const pythonPolicy = runNode(
  [path.join(root, 'tools', 'tooling', 'python-check.js'), '--json'],
  'python-check for sublime package harness',
  root,
  process.env,
  { stdio: 'pipe', allowFailure: true }
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
const fixtureRepo = path.join((await prepareIsolatedTestCacheDir('sublime-package-fixture', { root, clean: true })).dir, 'repo');
await fsPromises.mkdir(path.join(fixtureRepo, 'src'), { recursive: true });
await fsPromises.writeFile(
  path.join(fixtureRepo, 'src', 'index.js'),
  [
    'export function greet(name = "world") {',
    '  return `hello ${name}`;',
    '}',
    ''
  ].join('\n'),
  'utf8'
);
await fsPromises.writeFile(
  path.join(fixtureRepo, 'README.md'),
  '# Sublime package fixture\n\nminimal repo for package harness\n',
  'utf8'
);
const cacheRoot = (await prepareIsolatedTestCacheDir('sublime-package-harness', { root, clean: true })).dir;
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
    PAIROFCLEATS_SUBLIME_TEST_FIXTURE_REPO: fixtureRepo,
    PAIROFCLEATS_SUBLIME_PACKAGE_HARNESS_TRACE: process.env.PAIROFCLEATS_SUBLIME_PACKAGE_HARNESS_TRACE || null
  },
  syncProcess: false
});

// Each scenario owns an independent Python/Sublime state and temporary repository.
// Run the three bounded scenarios concurrently rather than eleven CLIs serially.
const scenarios = [
  'test_package_harness_exercises_real_search_index_map_and_advanced_workflows',
  'test_package_harness_analysis_workflows',
  'test_package_harness_workspace_workflows'
];
const results = await Promise.all(scenarios.map((scenario) => new Promise((resolve, reject) => {
  const child = spawn(python, [script, 'PackageHarnessTests.' + scenario], {
    env,
    stdio: 'inherit'
  });
  child.once('error', reject);
  child.once('exit', (code) => resolve(code ?? 1));
})));
if (results.some((code) => code !== 0)) {
  console.error('sublime-package-harness: python harness failed');
  process.exit(results.find((code) => code !== 0) || 1);
}

console.log('sublime package harness test passed');
