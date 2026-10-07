#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverFiles } from '../../../src/index/build/discover.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { withGeneratedArtifactMetadata } from '../../../src/shared/generated-artifact-core.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-owned-metadata-discovery-'));
const cache = path.join(root, 'custom-cache');
try {
  await fs.mkdir(path.join(root, 'authored'), { recursive: true });
  await fs.mkdir(cache, { recursive: true });
  await fs.writeFile(path.join(cache, 'authored.js'), 'export const keepAuthored = 1;\n');
  await fs.writeFile(path.join(cache, 'chunk_meta.json'), '[{"ownedButHeaderless":true}]');
  await fs.writeFile(path.join(root, 'authored', 'index_state.json'), '{"authored":true}');
  const state = withGeneratedArtifactMetadata({ generatedAt: '2026-10-06T00:00:00Z', mode: 'code' }, 'index-state');
  await fs.writeFile(path.join(cache, 'index_state.json'), JSON.stringify(state));
  await fs.writeFile(path.join(root, 'authored', 'example.json'), JSON.stringify({ documentation: state }));
  await writePiecesManifest({ outDir: cache, mode: 'code', indexState: {}, pieceEntries: [
    // Even a produced manifest naming source cannot nominate it for exclusion.
    { type: 'chunks', name: 'chunk_meta', path: 'authored.js', format: 'jsonl' }
  ] });
  const skippedFiles = [];
  const entries = await discoverFiles({ root, mode: 'code', skippedFiles, maxFileBytes: null,
    ignoreMatcher: { ignores: () => false } });
  const relative = entries.map(entry => entry.rel.replace(/\\/g, '/')).sort();
  assert.deepEqual(relative, ['authored/example.json', 'authored/index_state.json',
    'custom-cache/authored.js', 'custom-cache/chunk_meta.json']);
  const omitted = skippedFiles.filter(entry => entry.reason === 'generated-artifact');
  assert.deepEqual(omitted.map(entry => path.relative(root, entry.file).replace(/\\/g, '/')).sort(),
    ['custom-cache/index_state.json', 'custom-cache/pieces/manifest.json']);
  assert.ok(omitted.every(entry => entry.action === 'omit' && entry.artifactFlags === 1));
  console.log('Discovery omits marked metadata itself and preserves authored siblings and unbound members.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
