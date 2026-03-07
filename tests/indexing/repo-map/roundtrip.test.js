#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../src/contracts/versioning.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { createRepoMapIterator } from '../../../src/index/build/artifacts/writers/repo-map.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'repo-map-roundtrip');
const outDir = path.join(cacheRoot, 'index-code');

await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const chunks = [
  { file: 'src/a.js', ext: '.js', name: 'alpha', kind: 'FunctionDeclaration', startLine: 1, endLine: 2, docmeta: { signature: '(a)' } },
  { file: 'src/a.js', ext: '.js', name: 'alpha', kind: 'FunctionDeclaration', startLine: 1, endLine: 2, docmeta: { signature: '(a)' } }, // dup
  { file: 'src/a.js', ext: '.js', name: 'beta', kind: 'VariableDeclaration', startLine: 10, endLine: 11, docmeta: { signature: null } },
  { file: 'src/b.js', ext: '.js', name: 'gamma', kind: 'FunctionDeclaration', startLine: 3, endLine: 4, docmeta: { signature: '(g)' } }
];
const fileRelations = new Map([
  ['src/a.js', { exports: ['alpha'] }]
]);

const iterator = createRepoMapIterator({ chunks, fileRelations });
const expected = Array.from(iterator());

const maxBytes = 256;
const result = await writeJsonLinesSharded({
  dir: outDir,
  partsDirName: 'repo_map.parts',
  partPrefix: 'repo_map.part-',
  items: expected,
  maxBytes,
  atomic: true
});

const parts = result.parts.map((part, index) => ({
  path: part,
  records: result.counts[index] || 0,
  bytes: result.bytes[index] || 0
}));

await writeJsonObjectFile(path.join(outDir, 'repo_map.meta.json'), {
  fields: {
    schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
    artifact: 'repo_map',
    format: 'jsonl-sharded',
    generatedAt: new Date().toISOString(),
    compression: 'none',
    totalRecords: result.total,
    totalBytes: result.totalBytes,
    maxPartRecords: result.maxPartRecords,
    maxPartBytes: result.maxPartBytes,
    targetMaxBytes: result.targetMaxBytes,
    parts
  },
  atomic: true
});

const manifest = {
  version: 2,
  generatedAt: new Date().toISOString(),
  mode: 'code',
  stage: 'stage2',
  pieces: [
    ...result.parts.map((relPath, index) => ({
      type: 'chunks',
      name: 'repo_map',
      format: 'jsonl',
      count: result.counts[index] || 0,
      path: relPath
    })),
    {
      type: 'chunks',
      name: 'repo_map_meta',
      format: 'json',
      path: 'repo_map.meta.json'
    }
  ]
};

const loaded = await loadJsonArrayArtifact(outDir, 'repo_map', {
  manifest,
  strict: true,
  maxBytes: 1024 * 1024
});

if (stableStringify(loaded) !== stableStringify(expected)) {
  console.error('repo-map roundtrip failed: loaded rows mismatch.');
  process.exit(1);
}

console.log('repo-map roundtrip test passed');
