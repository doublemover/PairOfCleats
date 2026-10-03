#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const tempDir = path.join(root, '.testLogs', 'embeddings');
await fs.mkdir(tempDir, { recursive: true });
const scriptPath = path.join(tempDir, `embedding-batcher-unref-${process.pid}-${Date.now()}.mjs`);
const moduleUrl = pathToFileURL(path.join(root, 'src', 'index', 'build', 'file-processor', 'embeddings.js')).href;

await fs.writeFile(scriptPath, [
  `import { attachEmbeddings } from ${JSON.stringify(moduleUrl)};`,
  'const chunks = Array.from({ length: 4 }, () => ({}));',
  'const vectors = await attachEmbeddings({',
  '  chunks,',
  '  codeTexts: ["a", "b", "c", "d"],',
  '  docTexts: ["", "", "", ""],',
  '  embeddingEnabled: true,',
  '  embeddingNormalize: false,',
  '  getChunkEmbedding: async () => [1, 0],',
  '  getChunkEmbeddings: async (texts) => new Promise((resolve) => {',
  '    const timer = setTimeout(() => resolve(texts.map(() => [1, 0])), 25);',
  '    timer.unref?.();',
  '  }),',
  '  runEmbedding: (fn) => fn(),',
  '  embeddingBatchSize: 2,',
  '  fileLanguageId: "unknown",',
  '  languageOptions: {}',
  '});',
  'if (!vectors || !chunks.every((chunk) => chunk.embedding_u8 instanceof Uint8Array)) {',
  '  throw new Error("expected quantized embeddings to be attached");',
  '}',
  'console.log("embedding batcher keepalive ok");'
].join('\n'), 'utf8');

const result = runNode(
  [scriptPath],
  'embedding batcher unref timer',
  root,
  applyTestEnv({ syncProcess: false }),
  { stdio: 'pipe', timeoutMs: 5000 }
);

assert.equal(result.status, 0, `expected child to exit cleanly, stderr=${result.stderr}`);
assert.match(result.stdout, /embedding batcher keepalive ok/, 'expected attachEmbeddings to finish');
assert.doesNotMatch(
  `${result.stderr || ''}${result.stdout || ''}`,
  /Detected unsettled top-level await/,
  'expected no unsettled top-level await warning'
);

await fs.rm(scriptPath, { force: true });

console.log('embedding batcher unref timer test passed');
