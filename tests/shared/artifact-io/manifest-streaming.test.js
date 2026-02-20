#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const outDir = await prepareArtifactIoTestDir('artifact-io-manifest', { root });
const piecesDir = path.join(outDir, 'pieces');

const items = Array.from({ length: 120 }, (_value, index) => ({
  id: index,
  name: `item-${index}`
}));

const shardInfo = await writeJsonLinesSharded({
  dir: piecesDir,
  partsDirName: 'items.parts',
  partPrefix: 'items.part-',
  items,
  maxBytes: 256
});

const manifestParts = shardInfo.parts.map((part) => path.posix.join('pieces', part));

const metaPath = path.join(piecesDir, 'items.meta.json');
await writeJsonObjectFile(metaPath, {
  fields: {
    format: 'jsonl-sharded',
    parts: manifestParts,
    counts: shardInfo.counts,
    bytes: shardInfo.bytes,
    total: shardInfo.total
  }
});

const manifestPieces = manifestParts.map((part) => ({
  name: 'items',
  path: part
}));
manifestPieces.push({
  name: 'items_meta',
  path: 'pieces/items.meta.json'
});
await writePiecesManifest(outDir, manifestPieces);

const parsed = await loadJsonArrayArtifact(outDir, 'items');
if (!Array.isArray(parsed) || parsed.length !== items.length) {
  console.error('artifact-io manifest streaming failed: length mismatch.');
  process.exit(1);
}
if (parsed[0]?.id !== 0 || parsed[parsed.length - 1]?.id !== items.length - 1) {
  console.error('artifact-io manifest streaming failed: boundary entries mismatch.');
  process.exit(1);
}

console.log('artifact-io manifest streaming test passed');
