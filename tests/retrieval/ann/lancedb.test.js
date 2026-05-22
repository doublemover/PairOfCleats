#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { normalizeLanceDbConfig } from '../../../src/shared/lancedb.js';
import { requireLanceDb } from '../../helpers/optional-deps.js';
import { runNode } from '../../helpers/run-node.js';

import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const { dir: tempRoot } = await prepareIsolatedTestCacheDir('lancedb-ann', { root });
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await requireLanceDb({ reason: 'lancedb not available; skipping lancedb-ann test.' });

await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'main.js'),
  'export function indexItem(value) { return value + 1; }\n',
  'utf8'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'README.md'),
  '# LanceDB Fixture\n\nThis fixture provides prose chunks for ANN backend validation.\n',
  'utf8'
);

const env = applyTestEnv({
  cacheRoot: cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      embeddings: {
        lancedb: {
          enabled: true,
          isolate: false
        }
      },
      typeInference: false,
      typeInferenceCrossFile: false
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  }
});

const run = (args, label) => {
  runNode(args, label, repoRoot, env, { stdio: 'inherit' });
};

run(
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--scm-provider', 'none', '--stage', 'stage1', '--repo', repoRoot],
  'build index'
);
run([path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot], 'build embeddings (code)');
run([path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--mode', 'prose', '--repo', repoRoot], 'build embeddings (prose)');

const userConfig = loadUserConfig(repoRoot);
const lanceConfig = normalizeLanceDbConfig(userConfig.indexing?.embeddings?.lancedb || {});
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const proseDir = getIndexDir(repoRoot, 'prose', userConfig);
const codeDb = path.join(codeDir, 'dense_vectors.lancedb');
const codeDocDb = path.join(codeDir, 'dense_vectors_doc.lancedb');
const codeCodeDb = path.join(codeDir, 'dense_vectors_code.lancedb');
const proseDb = path.join(proseDir, 'dense_vectors.lancedb');
const proseDocDb = path.join(proseDir, 'dense_vectors_doc.lancedb');
const proseCodeDb = path.join(proseDir, 'dense_vectors_code.lancedb');
const codeMeta = path.join(codeDir, 'dense_vectors.lancedb.meta.json');
const codeDocMeta = path.join(codeDir, 'dense_vectors_doc.lancedb.meta.json');
const codeCodeMeta = path.join(codeDir, 'dense_vectors_code.lancedb.meta.json');
const proseMeta = path.join(proseDir, 'dense_vectors.lancedb.meta.json');
const proseDocMeta = path.join(proseDir, 'dense_vectors_doc.lancedb.meta.json');
const proseCodeMeta = path.join(proseDir, 'dense_vectors_code.lancedb.meta.json');

if (!fs.existsSync(codeDb) || !fs.existsSync(codeMeta)) {
  console.error('LanceDB index missing for code mode.');
  process.exit(1);
}
if (!fs.existsSync(codeDocDb) || !fs.existsSync(codeDocMeta)) {
  console.error('LanceDB doc index missing for code mode.');
  process.exit(1);
}
if (!fs.existsSync(codeCodeDb) || !fs.existsSync(codeCodeMeta)) {
  console.error('LanceDB code index missing for code mode.');
  process.exit(1);
}
if (!fs.existsSync(proseDb) || !fs.existsSync(proseMeta)) {
  console.error('LanceDB index missing for prose mode.');
  process.exit(1);
}
if (!fs.existsSync(proseDocDb) || !fs.existsSync(proseDocMeta)) {
  console.error('LanceDB doc index missing for prose mode.');
  process.exit(1);
}
if (!fs.existsSync(proseCodeDb) || !fs.existsSync(proseCodeMeta)) {
  console.error('LanceDB code index missing for prose mode.');
  process.exit(1);
}

const codeState = JSON.parse(fs.readFileSync(path.join(codeDir, 'index_state.json'), 'utf8'));
const proseState = JSON.parse(fs.readFileSync(path.join(proseDir, 'index_state.json'), 'utf8'));
if (codeState?.embeddings?.embeddingIdentity?.normalize !== true) {
  console.error('Expected code embeddingIdentity.normalize=true in index_state.json.');
  process.exit(1);
}
if (proseState?.embeddings?.embeddingIdentity?.normalize !== true) {
  console.error('Expected prose embeddingIdentity.normalize=true in index_state.json.');
  process.exit(1);
}

const codeMetaPayload = JSON.parse(fs.readFileSync(codeMeta, 'utf8'));
const codeDocMetaPayload = JSON.parse(fs.readFileSync(codeDocMeta, 'utf8'));
const codeCodeMetaPayload = JSON.parse(fs.readFileSync(codeCodeMeta, 'utf8'));
const proseMetaPayload = JSON.parse(fs.readFileSync(proseMeta, 'utf8'));
const proseDocMetaPayload = JSON.parse(fs.readFileSync(proseDocMeta, 'utf8'));
const proseCodeMetaPayload = JSON.parse(fs.readFileSync(proseCodeMeta, 'utf8'));
if (codeMetaPayload.metric !== lanceConfig.metric) {
  console.error(`Expected LanceDB code metric=${lanceConfig.metric}, got ${codeMetaPayload.metric}`);
  process.exit(1);
}
if (codeDocMetaPayload.metric !== lanceConfig.metric) {
  console.error(`Expected LanceDB code/doc metric=${lanceConfig.metric}, got ${codeDocMetaPayload.metric}`);
  process.exit(1);
}
if (codeCodeMetaPayload.metric !== lanceConfig.metric) {
  console.error(`Expected LanceDB code/code metric=${lanceConfig.metric}, got ${codeCodeMetaPayload.metric}`);
  process.exit(1);
}
if (proseMetaPayload.metric !== lanceConfig.metric) {
  console.error(`Expected LanceDB prose metric=${lanceConfig.metric}, got ${proseMetaPayload.metric}`);
  process.exit(1);
}
if (proseDocMetaPayload.metric !== lanceConfig.metric) {
  console.error(`Expected LanceDB prose/doc metric=${lanceConfig.metric}, got ${proseDocMetaPayload.metric}`);
  process.exit(1);
}
if (proseCodeMetaPayload.metric !== lanceConfig.metric) {
  console.error(`Expected LanceDB prose/code metric=${lanceConfig.metric}, got ${proseCodeMetaPayload.metric}`);
  process.exit(1);
}

const searchResult = runNode(
  [
    path.join(root, 'search.js'),
    'index',
    '--backend',
    'memory',
    '--json',
    '--stats',
    '--ann',
    '--repo',
    repoRoot
  ],
  'lancedb ann search',
  repoRoot,
  env,
  { stdio: 'pipe' }
);

const payload = JSON.parse(searchResult.stdout || '{}');
const stats = payload.stats || {};
if (stats.annBackend !== 'lancedb') {
  console.error(`Expected annBackend=lancedb, got ${stats.annBackend}`);
  process.exit(1);
}
if (!stats.annLance?.available?.code || !stats.annLance?.available?.prose) {
  console.error('Expected LanceDB availability for code and prose.');
  process.exit(1);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
console.log('LanceDB ANN test passed');

