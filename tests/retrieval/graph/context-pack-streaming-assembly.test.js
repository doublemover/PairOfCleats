#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { assembleCompositeContextPackStreaming } from '../../../src/context-pack/assemble.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'context-pack-streaming-assembly');
const repoRoot = path.join(tempRoot, 'repo');
const indexDir = path.join(tempRoot, 'index-code');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });

const repoFile = path.join(repoRoot, 'src', 'file.js');
const repoText = [
  'export function greet(name) {',
  '  return `hi ${name}`;',
  '}',
  ''
].join('\n');
await fs.writeFile(repoFile, repoText, 'utf8');
const repoBytes = Buffer.byteLength(repoText, 'utf8');

const chunkUid = 'chunk-000001';
await fs.writeFile(
  path.join(indexDir, 'chunk_uid_map.jsonl'),
  `${JSON.stringify({
    docId: 0,
    chunkId: '0',
    chunkUid,
    file: 'src/file.js',
    start: 0,
    end: repoBytes
  })}\n`,
  'utf8'
);

await writeJsonObjectFile(path.join(indexDir, 'index_state.json'), {
  fields: {
    artifactSurfaceVersion: 'test',
    buildId: 'streaming-assembly',
    mode: 'code',
    compatibilityKey: 'compat-test'
  },
  atomic: true
});

await writeJsonObjectFile(path.join(indexDir, 'pieces', 'manifest.json'), {
  fields: {
    fields: {
      version: 2,
      artifactSurfaceVersion: 'test',
      compatibilityKey: 'compat-test',
      generatedAt: new Date().toISOString(),
      mode: 'code',
      stage: 'streaming-assembly',
      pieces: [
        { name: 'chunk_uid_map', path: 'chunk_uid_map.jsonl', format: 'jsonl' }
      ]
    }
  },
  atomic: true
});

const stripStats = (value) => {
  const cloned = JSON.parse(JSON.stringify(value));
  delete cloned.stats;
  return cloned;
};

const fixedNow = () => '2026-02-01T00:00:00.000Z';

const payloadChunk = await assembleCompositeContextPackStreaming({
  seed: { type: 'chunk', chunkUid },
  repoRoot,
  indexDir,
  strict: true,
  indexCompatKey: 'compat-test',
  now: fixedNow,
  includeGraph: false,
  includeTypes: false,
  includeRisk: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false
});

assert.equal(payloadChunk?.primary?.file, 'src/file.js');
assert.ok(payloadChunk.primary.excerpt.includes('export function greet'), 'expected excerpt to be populated');
assert.ok(!payloadChunk.warnings?.some((w) => w?.code === 'CHUNK_UID_MAP_MISS'), 'expected chunk_uid_map to resolve seed');

const payloadFile = await assembleCompositeContextPackStreaming({
  seed: { type: 'file', path: 'src/file.js' },
  repoRoot,
  indexDir,
  strict: true,
  indexCompatKey: 'compat-test',
  now: fixedNow,
  includeGraph: false,
  includeTypes: false,
  includeRisk: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false
});
assert.equal(payloadFile?.primary?.file, 'src/file.js');
assert.ok(payloadFile.primary.excerpt.includes('export function greet'), 'expected excerpt via file seed');

const payloadRepeat = await assembleCompositeContextPackStreaming({
  seed: { type: 'chunk', chunkUid },
  repoRoot,
  indexDir,
  strict: true,
  indexCompatKey: 'compat-test',
  now: fixedNow,
  includeGraph: false,
  includeTypes: false,
  includeRisk: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false
});

assert.deepStrictEqual(stripStats(payloadRepeat), stripStats(payloadChunk), 'expected streaming assembly to be deterministic');

console.log('context pack streaming assembly test passed');
