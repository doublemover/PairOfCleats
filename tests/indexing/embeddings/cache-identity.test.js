#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildEmbeddingIdentity } from '../../../src/shared/embedding-identity.js';
import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode as runNodeSync } from '../../helpers/run-node.js';

import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/embeddings/cache-identity/')[1];
if (!['inline-publication', 'standalone-dimension-transition'].includes(mode)) throw new Error('Select one bounded cache identity case.');
const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const { dir: tempRoot } = await prepareIsolatedTestCacheDir(`embeddings-cache-identity-${mode}`, {
  root,
  clean: true
});
const repoRoot = path.join(tempRoot, 'repo');
const cacheRootBase = path.join(tempRoot, 'cache');
const cacheRoot = resolveVersionedCacheRoot(cacheRootBase);

await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = applyTestEnv({
  cacheRoot: cacheRootBase,
  embeddings: 'stub',
  testConfig: {
    threads: 1,
    indexing: {
      scm: { provider: 'none' },
      embeddings: {
        hnsw: { enabled: false },
        lancedb: { enabled: false }
      }
    },
    // Stub-cache publication is independent of installed optional providers.
    // Provider execution/identity has separate explicitly selected fixtures.
    tooling: { autoEnableOnDetect: false, autoInstallOnDetect: false, lsp: { enabled: false } }
  }
});

let childOrdinal = 0;
const runNode = async (label, args, cwd = repoRoot) => {
  const ordinal = ++childOrdinal, started = performance.now();
  console.log(JSON.stringify({ phase: 'child:start', ordinal, command: process.execPath, args, cwd }));
  const result = runNodeSync(args, label, cwd, env, { stdio: 'pipe', timeoutMs: 25000 });
  await fsPromises.writeFile(path.join(tempRoot, `child-${ordinal}.stdout.log`), result.stdout || '');
  await fsPromises.writeFile(path.join(tempRoot, `child-${ordinal}.stderr.log`), result.stderr || '');
  console.log(JSON.stringify({ phase: 'child:settled', ordinal, exitCode: result.status,
    elapsedMs: Math.round(performance.now() - started) }));
  return result;
};

const findPathsByName = async (rootDir, fileName) => {
  const matches = [];
  const walk = async (dir) => {
    let items;
    try {
      items = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (item.isFile() && item.name === fileName) {
        matches.push(fullPath);
      }
    }
  };
  await walk(rootDir);
  return matches.sort((a, b) => a.localeCompare(b));
};

await runNode('build_index failed', [
  path.join(root, 'bin', 'pairofcleats.js'), 'index', 'build',
  '--stub-embeddings',
  '--scm-provider',
  'none',
  '--mode',
  'code',
  '--no-sqlite',
  '--threads', '1',
  ...(mode === 'standalone-dimension-transition' ? ['--stage', 'stage1'] : []),
  '--repo',
  repoRoot
]);

if (mode === 'standalone-dimension-transition') {
  // The independent cold seed retains every original source/native parser.
  // Stage1 is the supported lexical input to standalone embedding publication;
  // the sibling case retains the complete original inline/enrichment pipeline.
  await runNode('build-embeddings dims=8 failed', [
    path.join(root, 'tools', 'build/embeddings.js'),
    '--stub-embeddings',
    '--mode',
    'code',
    '--dims',
    '8',
    '--repo',
    repoRoot
  ]);

  await runNode('build-embeddings dims=12 failed', [
    path.join(root, 'tools', 'build/embeddings.js'),
    '--stub-embeddings',
    '--mode',
    'code',
    '--dims',
    '12',
    '--repo',
    repoRoot
  ]);
}

const cacheIndexPaths = await findPathsByName(cacheRoot, 'cache.index.json');
if (cacheIndexPaths.length > 0) {
  console.error('embeddings cache identity test failed: expected no cache index artifacts in stub mode');
  console.error(cacheIndexPaths.join('\n'));
  process.exit(1);
}

const cacheMetaPaths = await findPathsByName(cacheRoot, 'cache.meta.json');
if (cacheMetaPaths.length > 0) {
  console.error('embeddings cache identity test failed: expected no cache metadata artifacts in stub mode');
  console.error(cacheMetaPaths.join('\n'));
  process.exit(1);
}

const onnxIdentity = buildEmbeddingIdentity({
  modelId: 'onnx-model',
  provider: 'onnx',
  mode: 'inline',
  stub: false,
  dims: 384,
  scale: 0.5,
  pooling: 'mean',
  normalize: true,
  truncation: 'truncate',
  maxLength: 128,
  onnx: {
    modelPath: 'models/onnx/model.onnx',
    tokenizerId: 'tokenizer-id',
    executionProviders: ['cpu'],
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'basic'
  }
});
if (!onnxIdentity?.onnx?.modelPath || !onnxIdentity?.onnx?.tokenizerId) {
  console.error('embeddings cache identity test failed: ONNX identity missing modelPath/tokenizerId');
  process.exit(1);
}

console.log('embeddings cache identity tests passed');
