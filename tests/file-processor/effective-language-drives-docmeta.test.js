#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFileProcessor } from '../../src/index/build/file-processor.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'effective-language-docmeta');
const repoRoot = path.join(tempRoot, 'repo');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

const mdPath = path.join(repoRoot, 'guide.md');
const text = [
  '# Guide',
  '',
  '```tsx',
  'export function greet(name: string) {',
  '  return name;',
  '}',
  '```',
  ''
].join('\n');
await fs.writeFile(mdPath, text);
const stat = await fs.stat(mdPath);

const { processFile } = createFileProcessor({
  root: repoRoot,
  mode: 'prose',
  dictConfig: {},
  dictWords: new Set(),
  languageOptions: { skipUnknownLanguages: false, astDataflowEnabled: false, controlFlowEnabled: false },
  postingsConfig: {},
  segmentsConfig: {},
  commentsConfig: {},
  contextWin: 0,
  incrementalState: {
    enabled: false,
    manifest: { files: {} },
    bundleDir: '',
    bundleFormat: 'json'
  },
  getChunkEmbedding: async () => null,
  getChunkEmbeddings: async () => null,
  typeInferenceEnabled: false,
  riskAnalysisEnabled: false,
  riskConfig: {},
  relationsEnabled: false,
  seenFiles: new Set(),
  gitBlameEnabled: false,
  lintEnabled: false,
  complexityEnabled: false,
  structuralMatches: null,
  cacheConfig: {},
  cacheReporter: null,
  queues: null,
  workerPool: null,
  crashLogger: null,
  skippedFiles: [],
  embeddingEnabled: false,
  toolInfo: { tool: 'pairofcleats', version: '0.0.0-test' },
  tokenizationStats: null
});

const fileEntry = {
  abs: mdPath,
  rel: 'guide.md',
  stat,
  lines: text.split('\n').length,
  scan: { checkedBinary: true, checkedMinified: true }
};

const result = await processFile(fileEntry, 0);
if (!result?.chunks?.length) {
  fail('Expected file processor to emit chunks.');
}
const chunk = result.chunks.find((entry) => entry.segment?.languageId === 'tsx');
if (!chunk) {
  fail('Expected tsx fenced chunk in file processor output.');
}
if (!chunk.docmeta?.signature) {
  fail('Expected TypeScript docmeta signature for fenced TSX chunk.');
}

console.log('effective language docmeta ok');
