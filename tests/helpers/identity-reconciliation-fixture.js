import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJsonLinesFile } from '../../src/shared/json-stream/jsonl-write.js';
import { createBaseIndex } from '../indexing/validate/helpers.js';
import { resolveTestCachePath } from './test-cache.js';

const PRESENT_CHUNK_UID = 'ck64:v1:repo:src/a.js#seg:segu:v1:seg-a:0011223344556677';
const MISSING_CHUNK_UID = 'ck64:v1:repo:src/missing.js#seg:segu:v1:seg-x:ffeeddccbbaa9988';
const SEGMENT_VIRTUAL_PATH = 'src/a.js#seg:segu:v1:seg-a';

export const createIdentityReconciliationDriftIndex = async ({
  root = process.cwd(),
  cacheName
} = {}) => {
  if (!cacheName) {
    throw new TypeError('createIdentityReconciliationDriftIndex requires cacheName');
  }

  const tempRoot = resolveTestCachePath(root, cacheName);
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });

  const { indexRoot, indexDir, manifest } = await createBaseIndex({
    rootDir: tempRoot,
    chunkMeta: [
      {
        id: 0,
        file: 'src/a.js',
        chunkId: 'chunk_0',
        chunkUid: PRESENT_CHUNK_UID,
        virtualPath: SEGMENT_VIRTUAL_PATH,
        metaV2: {
          chunkId: 'chunk_0',
          chunkUid: PRESENT_CHUNK_UID,
          virtualPath: SEGMENT_VIRTUAL_PATH,
          file: 'src/a.js',
          segment: { segmentUid: 'segu:v1:seg-a', virtualPath: SEGMENT_VIRTUAL_PATH }
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
      virtualPath: SEGMENT_VIRTUAL_PATH,
      chunkUid: MISSING_CHUNK_UID
    }
  ], { atomic: true });

  manifest.pieces.push({
    type: 'symbols',
    name: 'symbols',
    format: 'jsonl',
    path: 'symbols.jsonl',
    count: 1
  });
  await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest, null, 2));

  return { indexRoot, indexDir };
};
