#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createFileProcessor } from '../../../src/index/build/file-processor.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'framework-profile-docmeta');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'app', 'blog', '[slug]'), { recursive: true });

const targetPath = path.join(repoRoot, 'app', 'blog', '[slug]', 'page.tsx');
const source = [
  "'use client';",
  'export default function Page({ params }) {',
  '  return <div>{params.slug}</div>;',
  '}'
].join('\n');
await fsPromises.writeFile(targetPath, source);
const stat = await fsPromises.stat(targetPath);

const { processFile } = createFileProcessor({
  root: repoRoot,
  mode: 'code',
  dictConfig: {},
  dictWords: new Set(),
  languageOptions: {
    skipUnknownLanguages: true,
    astDataflowEnabled: false,
    controlFlowEnabled: false,
    treeSitter: { enabled: false }
  },
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
  toolInfo: null,
  tokenizationStats: null
});

const fileEntry = {
  abs: targetPath,
  rel: path.join('app', 'blog', '[slug]', 'page.tsx'),
  stat,
  lines: source.split('\n').length,
  scan: { checkedBinary: true, checkedMinified: true }
};

const result = await processFile(fileEntry, 0);
if (!result?.chunks?.length) {
  fail('Expected Next page file to produce chunks.');
}

const frameworkProfile = result.chunks[0]?.docmeta?.frameworkProfile;
if (!frameworkProfile || frameworkProfile.id !== 'next') {
  fail('Expected framework profile id=next in chunk docmeta.');
}
if (frameworkProfile.signals?.nextAppRouterDynamicSegment !== true) {
  fail('Expected nextAppRouterDynamicSegment signal for dynamic app route.');
}

console.log('framework profile docmeta test passed');
