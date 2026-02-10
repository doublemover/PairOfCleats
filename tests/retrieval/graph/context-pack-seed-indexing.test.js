#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { assembleCompositeContextPackStreaming } from '../../../src/context-pack/assemble.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'context-pack-seed-indexing');
const repoRoot = path.join(tempRoot, 'repo');
const indexDir = path.join(tempRoot, 'index-code');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });

const repoFile = path.join(repoRoot, 'src', 'main.js');
const repoText = [
  'export function main(name) {',
  '  return `hello ${name}`;',
  '}',
  ''
].join('\n');
await fs.writeFile(repoFile, repoText, 'utf8');
const repoBytes = Buffer.byteLength(repoText, 'utf8');

const targetChunkUid = 'chunk-target-037';
const rowCount = 50;
const lines = [];
for (let i = 0; i < rowCount; i += 1) {
  const isTarget = i === 37;
  const chunkUid = isTarget ? targetChunkUid : `chunk-${String(i).padStart(3, '0')}`;
  lines.push(JSON.stringify({
    docId: i,
    chunkId: String(i),
    chunkUid,
    file: isTarget ? 'src/main.js' : `src/file-${i}.js`,
    start: 0,
    end: isTarget ? repoBytes : 16
  }));
}
await fs.writeFile(path.join(indexDir, 'chunk_uid_map.jsonl'), `${lines.join('\n')}\n`, 'utf8');

await writeJsonObjectFile(path.join(indexDir, 'index_state.json'), {
  fields: {
    artifactSurfaceVersion: 'test',
    buildId: 'seed-indexing',
    mode: 'code',
    compatibilityKey: 'compat-seed-indexing'
  },
  atomic: true
});

await writeJsonObjectFile(path.join(indexDir, 'pieces', 'manifest.json'), {
  fields: {
    fields: {
      version: 2,
      artifactSurfaceVersion: 'test',
      compatibilityKey: 'compat-seed-indexing',
      generatedAt: new Date().toISOString(),
      mode: 'code',
      stage: 'seed-indexing',
      pieces: [
        { name: 'chunk_uid_map', path: 'chunk_uid_map.jsonl', format: 'jsonl' }
      ]
    }
  },
  atomic: true
});

const commonOptions = {
  repoRoot,
  indexDir,
  strict: true,
  indexCompatKey: 'compat-seed-indexing',
  now: () => '2026-02-01T00:00:00.000Z',
  includeGraph: false,
  includeTypes: false,
  includeRisk: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false
};

const envelopeSeedPayload = await assembleCompositeContextPackStreaming({
  ...commonOptions,
  seed: {
    v: 1,
    status: 'resolved',
    resolved: { type: 'chunk', chunkUid: targetChunkUid },
    candidates: [
      { type: 'chunk', chunkUid: 'missing-chunk' },
      { type: 'file', path: 'src/missing.js' }
    ]
  }
});

assert.equal(envelopeSeedPayload?.primary?.file, 'src/main.js', 'expected indexed seed resolution to hit target file');
assert.ok(
  envelopeSeedPayload.primary.excerpt.includes('export function main'),
  'expected excerpt from indexed chunk seed'
);
assert.equal(
  envelopeSeedPayload?.stats?.seedResolution?.strategy,
  'chunk_uid_map_index',
  'expected indexed seed resolution strategy'
);
assert.equal(
  envelopeSeedPayload?.stats?.seedResolution?.rowsIndexed,
  rowCount,
  'expected seed index stats to report indexed chunk_uid_map rows'
);
assert.equal(
  envelopeSeedPayload?.stats?.seedResolution?.hit,
  true,
  'expected indexed seed resolution to report hit=true'
);

const fileSeedPayload = await assembleCompositeContextPackStreaming({
  ...commonOptions,
  seed: { type: 'file', path: 'src/main.js' }
});

assert.equal(fileSeedPayload?.primary?.file, 'src/main.js', 'expected file seed to resolve via indexed map');
assert.equal(
  fileSeedPayload?.stats?.seedResolution?.rowsIndexed,
  rowCount,
  'expected file seed lookup to reuse indexed rows accounting'
);

console.log('context pack seed indexing test passed');
