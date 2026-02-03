#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'symbol-artifact-determinism');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRootA = path.join(tempRoot, 'cache-a');
const cacheRootB = path.join(tempRoot, 'cache-b');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRootA, { recursive: true });
await fsPromises.mkdir(cacheRootB, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'creator.js'),
  `/**\n * @returns {Widget}\n */\nexport function createWidget() {\n  return new Widget();\n}\n\nexport class Widget {\n  constructor() {\n    this.id = 1;\n  }\n}\n`
);

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'consumer.js'),
  `import { createWidget, Widget } from './creator.js';\n\nexport function buildWidget() {\n  const widget = new Widget();\n  return createWidget();\n}\n`
);

const testConfig = {
  indexing: {
    typeInference: true,
    typeInferenceCrossFile: true
  },
  tooling: {
    autoEnableOnDetect: false
  }
};
const testConfigJson = JSON.stringify(testConfig);

const buildIndex = (cacheRoot) => {
  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig
  });
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'build_index.js'), '--stub-embeddings', '--scm-provider', 'none', '--repo', repoRoot],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    if (result.error) {
      console.error('build_index spawn error:', result.error);
    }
    const crashLogPath = path.join(repoRoot, 'logs', 'index-crash.log');
    if (fs.existsSync(crashLogPath)) {
      const crashLog = fs.readFileSync(crashLogPath, 'utf8');
      const tail = crashLog.length > 2000 ? crashLog.slice(-2000) : crashLog;
      console.error('build_index crash log (tail):\n' + tail);
    }
  }
  return result;
};

const loadArtifacts = (cacheRoot) => {
  applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig
  });

  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const readJsonl = (name) => {
    const filePath = path.join(codeDir, `${name}.jsonl`);
    if (!fs.existsSync(filePath)) {
      console.error(`Missing ${name}.jsonl at ${filePath}`);
      process.exit(1);
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return lines.map((line) => JSON.parse(line));
  };

  return {
    symbols: readJsonl('symbols'),
    symbol_occurrences: readJsonl('symbol_occurrences'),
    symbol_edges: readJsonl('symbol_edges')
  };
};

const first = buildIndex(cacheRootA);
if (first.status !== 0) {
  console.error('symbol artifact determinism test failed: first build failed');
  process.exit(first.status ?? 1);
}

const second = buildIndex(cacheRootB);
if (second.status !== 0) {
  console.error('symbol artifact determinism test failed: second build failed');
  process.exit(second.status ?? 1);
}

const firstArtifacts = loadArtifacts(cacheRootA);
const secondArtifacts = loadArtifacts(cacheRootB);

const compare = (label, left, right) => {
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  if (leftJson !== rightJson) {
    console.error(`symbol artifact determinism test failed: ${label} mismatch`);
    process.exit(1);
  }
};

compare('symbols', firstArtifacts.symbols, secondArtifacts.symbols);
compare('symbol_occurrences', firstArtifacts.symbol_occurrences, secondArtifacts.symbol_occurrences);
compare('symbol_edges', firstArtifacts.symbol_edges, secondArtifacts.symbol_edges);

console.log('symbol artifact determinism test passed');
