import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createBaseIndex, defaultUserConfig } from '../indexing/validate/helpers.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../src/contracts/versioning.js';
import { createXxhash64Hasher } from '../../src/shared/hash/xxhash-backend.js';

export const validationDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const seedValidationWorkFixture = async (rootDir, { layout = 'jsonl', rows = 8, paddingBytes = 128, algorithm = 'sha256' } = {}) => {
  const chunkMeta = Array.from({ length: rows }, (_, id) => ({ id, file: 'src/a.js', start: id, end: id + 1,
    lang: 'javascript', chunkUid: 'ck64:v1:test:src/a.js:' + String(id + 1).padStart(16, '0'), virtualPath: 'src/a.js', padding: '雪😀x'.repeat(Math.ceil(paddingBytes / 8)) }));
  const fixture = await createBaseIndex({ rootDir, chunkMeta,
    tokenPostings: { vocab: ['alpha'], postings: [rows ? [[0, 1]] : []], docLengths: Array(rows).fill(1), avgDocLen: rows ? 1 : 0, totalDocs: rows },
    indexState: { mode: 'code', artifactSurfaceVersion: (await import('../../src/contracts/versioning.js')).ARTIFACT_SURFACE_VERSION,
      generatedAt: '2026-11-05T00:00:00.000Z' }, fileLists: { generatedAt: '2026-11-05T00:00:00.000Z', scanned: { count: 1, sample: [] }, skipped: { count: 0, sample: [] } } });
  const { indexDir, manifest } = fixture;
  const normalized = JSON.parse(await fs.readFile(path.join(indexDir, 'chunk_meta.json'), 'utf8'));
  const chunkPaths = [];
  if (layout !== 'json') {
    await fs.rm(path.join(indexDir, 'chunk_meta.json'));
    manifest.pieces = manifest.pieces.filter(piece => piece.name !== 'chunk_meta');
    const groups = layout === 'sharded' ? Array.from({ length: 4 }, (_, index) => normalized.slice(Math.floor(index * rows / 4), Math.floor((index + 1) * rows / 4))) : [normalized];
    const parts = [];
    for (const [index, group] of groups.entries()) {
      const relative = layout === 'sharded' ? 'chunk_meta.parts/chunk_meta.part-' + String(index).padStart(5, '0') + '.jsonl'
        : 'chunk_meta.jsonl' + (layout === 'gzip' ? '.gz' : '');
      const plain = Buffer.from(group.map(row => JSON.stringify(row)).join('\n') + (group.length ? '\n' : ''));
      const bytes = layout === 'gzip' ? gzipSync(plain) : plain;
      await fs.mkdir(path.dirname(path.join(indexDir, relative)), { recursive: true });
      await fs.writeFile(path.join(indexDir, relative), bytes); chunkPaths.push(relative);
      parts.push({ path: relative, records: group.length, bytes: bytes.length });
      manifest.pieces.push({ name: 'chunk_meta', type: 'chunks', path: relative, format: 'jsonl', count: group.length });
    }
    if (layout === 'sharded') {
      const sizes = parts.map(part => part.bytes);
      await fs.writeFile(path.join(indexDir, 'chunk_meta.meta.json'), JSON.stringify({ schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
        artifact: 'chunk_meta', format: 'jsonl-sharded', generatedAt: '2026-11-05T00:00:00.000Z', compression: 'none',
        totalRecords: rows, totalBytes: sizes.reduce((a, b) => a + b, 0), maxPartRecords: Math.max(...parts.map(part => part.records)),
        maxPartBytes: Math.max(...sizes), targetMaxBytes: null, parts }));
      manifest.pieces.push({ name: 'chunk_meta_meta', type: 'chunks', path: 'chunk_meta.meta.json', format: 'json' });
    }
  } else chunkPaths.push('chunk_meta.json');
  // The cold projection exercises the real hot/cold merge; an unknown binary
  // piece remains checksum-only and must never disappear behind decode fusion.
  if (rows) {
    await fs.writeFile(path.join(indexDir, 'chunk_meta_cold.json'), JSON.stringify([{ id: 0, stats: { tokens: 1 } }]));
    manifest.pieces.push({ name: 'chunk_meta_cold', type: 'chunks', path: 'chunk_meta_cold.json', format: 'json' });
  }
  await fs.writeFile(path.join(indexDir, 'audit-opaque.bin'), Buffer.from([0, 255, 128, 1, 10]));
  manifest.pieces.push({ name: 'chunk_uid_map', type: 'stats', path: 'audit-opaque.bin', format: 'binary' });
  const inventory = [];
  for (const piece of manifest.pieces) {
    const bytes = await fs.readFile(path.join(indexDir, piece.path));
    let hash;
    if (algorithm === 'xxh64') { const hasher = await createXxhash64Hasher(); hasher.update(bytes); hash = hasher.digest(); }
    else hash = createHash(algorithm).update(bytes).digest('hex');
    piece.checksum = algorithm + ':' + hash; piece.bytes = bytes.length;
    inventory.push({ path: piece.path, bytes: bytes.length, sha256: validationDigest(bytes) });
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  await fs.writeFile(path.join(indexDir, 'pieces/manifest.json'), manifestBytes);
  inventory.push({ path: 'pieces/manifest.json', bytes: manifestBytes.length, sha256: validationDigest(manifestBytes) });
  return { ...fixture, chunkPaths, inventory, inputDigest: validationDigest(JSON.stringify(inventory)),
    input: { root: fixture.repoRoot, indexRoot: fixture.indexRoot, modes: ['code'], userConfig: defaultUserConfig,
      strict: true, sqliteEnabled: false, lmdbEnabled: false } };
};
