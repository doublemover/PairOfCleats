#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { readTextFile } from '../../../src/shared/encoding.js';

import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'encoding');
const cacheRoot = resolveTestCachePath(root, 'encoding-fallback');
const sourcePath = path.join(fixtureRoot, 'latin1.js');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const { text, usedFallback, encoding } = await readTextFile(sourcePath);
if (!text.includes('café')) {
  console.error('Encoding fallback did not decode latin1.js correctly.');
  process.exit(1);
}
if (!usedFallback) {
  console.error('Expected encoding fallback to be used for latin1.js.');
  process.exit(1);
}
const allowedEncodings = new Set(['latin1', 'iso-8859-1', 'iso-8859-2', 'windows-1252']);
if (encoding && !allowedEncodings.has(encoding)) {
  console.error(`Unexpected fallback encoding for latin1.js: ${encoding}`);
  process.exit(1);
}

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: {
        enabled: false
      }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  },
  syncProcess: false
});

const buildResult = runNode(
  [
    path.join(root, 'build_index.js'),
    '--stub-embeddings',
    '--stage',
    'stage1',
    '--mode',
    'code',
    '--scm-provider',
    'none',
    '--repo',
    fixtureRoot
  ],
  'encoding fallback build index',
  fixtureRoot,
  env,
  { stdio: 'inherit' }
);

const searchResult = runNode(
  [path.join(root, 'search.js'), '--json', '--mode', 'code', '--repo', fixtureRoot, 'café'],
  'encoding fallback search',
  fixtureRoot,
  env,
  { stdio: 'pipe', encoding: 'utf8' }
);
let payload = null;
try {
  payload = JSON.parse(searchResult.stdout || '{}');
} catch {
  console.error('Search output is not valid JSON.');
  process.exit(1);
}
const hits = Array.isArray(payload?.code) ? payload.code : [];
const hit = hits.find((entry) => typeof entry?.file === 'string' && entry.file.endsWith('latin1.js'));
if (!hit) {
  console.error('Expected search hit for latin1.js in encoding fixture.');
  process.exit(1);
}

console.log('encoding fallback test passed');

