#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { ensureFixtureIndex, loadFixtureIndexMeta } from '../../helpers/fixture-index.js';

const hasPython = () => {
  const candidates = ['python', 'python3'];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ['-c', 'import sys; sys.stdout.write("ok")'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === 'ok') return true;
  }
  return false;
};

if (!hasPython()) {
  console.log('Skipping Python contract checks (python not available).');
  process.exit(0);
}

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture'
});
const { chunkMeta, resolveChunkFile } = loadFixtureIndexMeta(fixtureRoot, userConfig);

const pointChunk = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/python_advanced.py'
  && String(chunk.name || '').includes('Point')
  && String(chunk.kind || '').includes('Class')
);
if (!pointChunk) {
  console.error('Missing Python dataclass chunk (Point).');
  process.exit(1);
}
const fields = pointChunk.docmeta?.fields || [];
const fieldNames = fields.map((field) => field.name);
if (!fieldNames.includes('x') || !fieldNames.includes('y')) {
  console.error('Python dataclass fields missing for Point (expected x,y).');
  process.exit(1);
}

const fetchData = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/python_advanced.py'
  && String(chunk.name || '').includes('fetch_data')
);
if (!fetchData) {
  console.error('Missing Python async chunk (fetch_data).');
  process.exit(1);
}
if (!fetchData.docmeta?.async) {
  console.error('Python async metadata missing for fetch_data.');
  process.exit(1);
}

console.log('Python contract checks ok.');
