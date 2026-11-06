import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION, SHARDED_JSONL_META_SCHEMA_VERSION } from '../../src/contracts/versioning.js';
import { MINHASH_HASH_IDENTITY } from '../../src/index/minhash.js';

export const healthDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const seedFixtureHealthWork = async (root, { modes = ['code'], rows = 16, paddingBytes = 256,
  layout = 'sharded', cold = true, empty = false } = {}) => {
  const modeDirs = {}, inventory = [];
  const write = async (dir, file, data) => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), bytes);
    inventory.push({ path: path.relative(root, path.join(dir, file)).replaceAll(path.sep, '/'), bytes: bytes.length, sha256: healthDigest(bytes) });
    return bytes.length;
  };
  for (const mode of modes) {
    const dir = path.join(root, mode); modeDirs[mode] = dir;
    const chunks = empty ? [] : Array.from({ length: rows }, (_, id) => ({ id, start: id * 8, end: id * 8 + 7,
      fileId: id === 0 ? 0 : 1, file: id === 0 ? 'query.psql' : 'source.js', lang: id === 0 ? 'sql' : 'javascript',
      chunkUid: 'ck64:v1:test:health:' + String(id + 1).padStart(16, '0'), virtualPath: id === 0 ? 'query.psql' : 'source.js',
      docmeta: id === 0 ? { dialect: 'postgres' } : { risk: { tags: ['source'], flows: [] } },
      padding: '雪😀x'.repeat(Math.ceil(paddingBytes / 8)) }));
    const pieces = [], parts = [];
    const groups = layout === 'sharded' ? Array.from({ length: 4 }, (_, index) => chunks.slice(Math.floor(index * chunks.length / 4), Math.floor((index + 1) * chunks.length / 4))) : [chunks];
    for (const [index, group] of groups.entries()) {
      const file = layout === 'json' ? 'chunk_meta.json' : layout === 'sharded' ? 'chunk_meta.parts/part-' + index + '.jsonl'
        : 'chunk_meta.jsonl' + (layout === 'gzip' ? '.gz' : '');
      const plain = Buffer.from(layout === 'json' ? JSON.stringify(group) : group.map(row => JSON.stringify(row)).join('\n') + (group.length ? '\n' : ''));
      const bytes = layout === 'gzip' ? gzipSync(plain) : plain;
      await write(dir, file, bytes); pieces.push({ name: 'chunk_meta', path: file, format: layout === 'json' ? 'json' : 'jsonl', count: group.length });
      parts.push({ path: file, records: group.length, bytes: bytes.length });
    }
    if (layout === 'sharded') {
      await write(dir, 'chunk_meta.meta.json', { schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION, artifact: 'chunk_meta', format: 'jsonl-sharded',
        generatedAt: '2026-11-05T00:00:00.000Z', compression: 'none', totalRecords: chunks.length,
        totalBytes: parts.reduce((sum, part) => sum + part.bytes, 0), maxPartRecords: Math.max(...parts.map(part => part.records)),
        maxPartBytes: Math.max(...parts.map(part => part.bytes)), targetMaxBytes: null, parts });
      pieces.push({ name: 'chunk_meta_meta', path: 'chunk_meta.meta.json', format: 'json' });
    }
    if (cold) {
      await write(dir, 'chunk_meta_cold.json', empty ? [] : [{ id: rows - 1, stats: { tokens: 1 } }]);
      pieces.push({ name: 'chunk_meta_cold', path: 'chunk_meta_cold.json', format: 'json' });
    }
    await write(dir, 'file_meta.json', empty ? [] : [{ id: 0, file: 'query.psql' }, { id: 1, file: 'source.js' }]);
    pieces.push({ name: 'file_meta', path: 'file_meta.json', format: 'json' });
    if (empty) {
      // Packed minhash requires a positive count. Canonical empty signatures
      // use the supported JSON representation; keep that format contract strict.
      await write(dir, 'minhash_signatures.json', { hashIdentity: MINHASH_HASH_IDENTITY, signatures: [] });
      pieces.push({ name: 'minhash_signatures', path: 'minhash_signatures.json', format: 'json' });
    } else {
      const packed = Buffer.alloc(rows * 8);
      for (let index = 0; index < packed.length / 4; index++) packed.writeUInt32LE(index + 1, index * 4);
      await write(dir, 'minhash_signatures.packed.bin', packed);
      await write(dir, 'minhash_signatures.packed.meta.json', { hashIdentity: MINHASH_HASH_IDENTITY, format: 'u32', endian: 'le', dims: 2, count: rows });
      pieces.push({ name: 'minhash_signatures', path: 'minhash_signatures.packed.bin', format: 'packed' },
        { name: 'minhash_signatures_meta', path: 'minhash_signatures.packed.meta.json', format: 'json' });
    }
    if (mode === 'code') {
      await write(dir, 'risk_flows.json', empty ? [] : [{ schemaVersion: 1, flowId: 'fixture-flow', source: {}, sink: {}, confidence: 1,
        notes: [], path: { callSiteIdsByStep: ['site-0'], watchByStep: [[]] } }]);
      pieces.push({ name: 'risk_flows', path: 'risk_flows.json', format: 'json' });
    }
    await write(dir, 'pieces/manifest.json', { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, compatibilityKey: 'health-work-current', mode, pieces });
  }
  return { modeDirs, requiredModes: modes, inventory, inputDigest: healthDigest(JSON.stringify(inventory)), rowsPerMode: empty ? 0 : rows };
};
