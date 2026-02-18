#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadChunkMeta } from '../../../src/shared/artifact-io.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'metaV2-backcompat-v2-reader');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const row = {
  id: 0,
  file: 'docs/legacy.docx',
  ext: '.docx',
  start: 0,
  end: 100,
  startLine: 1,
  endLine: 1,
  kind: 'DocumentParagraph',
  name: 'legacy',
  metaV2: {
    chunkId: 'legacy-0',
    file: 'docs/legacy.docx',
    segment: {
      type: 'docx',
      paragraphStart: '3',
      paragraphEnd: '4'
    },
    unknownLegacyField: 'legacy-ok'
  }
};

await fs.writeFile(path.join(tempRoot, 'chunk_meta.json'), JSON.stringify([row], null, 2), 'utf8');

const loaded = await loadChunkMeta(tempRoot, {
  strict: false,
  includeCold: false
});

assert.equal(Array.isArray(loaded), true, 'expected loaded chunk_meta rows');
assert.equal(loaded.length, 1, 'expected one loaded row');
const meta = loaded[0]?.metaV2;
assert.ok(meta, 'expected metaV2 row');
assert.equal(meta.schemaVersion, 2, 'expected missing schemaVersion to normalize to v2 fallback');
assert.equal(meta.segment?.sourceType, 'docx', 'expected sourceType inferred from legacy segment.type');
assert.equal(meta.segment?.paragraphStart, 3, 'expected normalized paragraphStart');
assert.equal(meta.segment?.paragraphEnd, 4, 'expected normalized paragraphEnd');
assert.equal(meta.segment?.anchor, null, 'expected missing anchor normalized to null');
assert.equal(meta.unknownLegacyField, 'legacy-ok', 'expected unknown legacy field preserved');

console.log('metaV2 backcompat v2 reader test passed');
