#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { reuseCachedBundle } from '../../../src/index/build/file-processor/cached-bundle.js';
import { finalizeMetaV2 } from '../../../src/index/metadata-v2.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'cached-bundle-metav2');
const repoRoot = path.join(tempRoot, 'repo');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

const targetPath = path.join(repoRoot, 'cached.js');
await fs.writeFile(targetPath, 'export const demo = 1;\n');
const stat = await fs.stat(targetPath);

const cachedBundle = {
  chunks: [
    {
      file: 'cached.js',
      ext: '.js',
      start: 0,
      end: 10,
      startLine: 1,
      endLine: 1,
      kind: 'code',
      name: 'demo',
      lang: 'javascript',
      chunkUid: 'ck:cached-demo',
      virtualPath: 'cached.js',
      docmeta: { signature: 'demo()' },
      tokens: ['demo'],
      seq: ['demo'],
      ngrams: [],
      chargrams: []
    }
  ],
  fileRelations: { importLinks: [] }
};

const { result, skip } = reuseCachedBundle({
  abs: targetPath,
  relKey: 'cached.js',
  fileIndex: 0,
  fileStat: stat,
  fileHash: 'hash',
  fileHashAlgo: 'sha1',
  ext: '.js',
  fileCaps: {},
  cachedBundle,
  incrementalState: {
    manifest: {
      files: {
        'cached.js': { bundle: 'cached.json', hash: 'hash' }
      }
    }
  },
  fileStructural: null,
  toolInfo: null,
  fileStart: Date.now(),
  knownLines: 1,
  fileLanguageId: null
});

if (skip || !result?.chunks?.length) {
  fail('Expected cached bundle reuse to succeed.');
}

const chunk = result.chunks[0];
if (chunk.metaV2?.types?.inferred?.returns) {
  fail('Expected cached bundle metaV2 to not include inferred returns before enrichment.');
}

chunk.docmeta = {
  ...chunk.docmeta,
  inferredTypes: {
    returns: [{ type: 'Widget', source: 'flow', confidence: 0.7 }]
  }
};

finalizeMetaV2({
  chunks: result.chunks,
  toolInfo: { tool: 'pairofcleats', version: '0.0.0-test' },
  analysisPolicy: { metadata: { enabled: true } }
});

const inferred = chunk.metaV2?.types?.inferred?.returns || [];
if (!inferred.some((entry) => entry.type === 'Widget' && entry.source === 'flow')) {
  fail('Expected finalized metaV2 to include post-enrichment inferred return types.');
}

console.log('cached bundle metaV2 finalization test passed');
