#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import { assertArtifactIdentityReconciliationReady } from '../../../src/index/build/artifacts-write/publication.js';
import { createBaseIndex } from '../validate/helpers.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'artifact-publication-identity-gate');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const uidA = 'ck64:v1:repo:src/a.js#seg:segu:v1:seg-a:0011223344556677';
const missingUid = 'ck64:v1:repo:src/missing.js#seg:segu:v1:seg-x:ffeeddccbbaa9988';

const { indexDir, manifest } = await createBaseIndex({
  rootDir: tempRoot,
  chunkMeta: [
    {
      id: 0,
      file: 'src/a.js',
      chunkId: 'chunk_0',
      chunkUid: uidA,
      virtualPath: 'src/a.js#seg:segu:v1:seg-a',
      metaV2: {
        chunkId: 'chunk_0',
        chunkUid: uidA,
        virtualPath: 'src/a.js#seg:segu:v1:seg-a',
        file: 'src/a.js',
        segment: { segmentUid: 'segu:v1:seg-a', virtualPath: 'src/a.js#seg:segu:v1:seg-a' }
      }
    }
  ]
});

await writeJsonLinesFile(path.join(indexDir, 'symbols.jsonl'), [
  {
    v: 1,
    symbolId: 'sym1:heur:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    scopedId: 'scope:a',
    symbolKey: 'symkey:a',
    qualifiedName: 'A',
    kindGroup: 'function',
    file: 'src/a.js',
    virtualPath: 'src/a.js#seg:segu:v1:seg-a',
    chunkUid: missingUid
  }
], { atomic: true });

manifest.pieces.push({ type: 'symbols', name: 'symbols', format: 'jsonl', path: 'symbols.jsonl', count: 1 });
await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest, null, 2));

await assert.rejects(
  () => assertArtifactIdentityReconciliationReady({
    outDir: indexDir,
    mode: 'code'
  }),
  /\[identity\].*symbols chunkUid missing in chunk_meta/i
);

console.log('artifact publication identity gate test passed');
