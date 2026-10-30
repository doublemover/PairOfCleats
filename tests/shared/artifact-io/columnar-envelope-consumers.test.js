import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { inflateColumnarRows, iterateColumnarRows } from '../../../src/shared/artifact-io/columnar-rows.js';
import { buildColumnarChunkMetaFromRows } from '../../../src/index/build/artifacts/writers/chunk-meta/iterator.js';
import { buildFileMetaColumnar } from '../../../src/index/build/artifacts/file-meta.js';
import { loadJsonArrayArtifact, loadJsonArrayArtifactRows, loadFileMetaRows } from '../../../src/shared/artifact-io/loaders.js';
import { loadChunkMetaRows } from '../../../src/shared/artifact-io/loaders/chunk-meta.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('columnar-envelope-consumers');
const collect = async rows => {
  const out = [];
  try { for await (const row of rows) out.push(row); }
  catch (error) {
    assert.equal(out.length, 0, 'every malformed envelope/count must reject before the first emitted row');
    throw error;
  }
  return out;
};
const base = { format: 'columnar', columns: ['id', 'file'], arrays: { id: [0], file: ['src/a.js'] }, length: 1 };
const malformed = [null, {}, { ...base, length: -1 }, { ...base, length: 1.5 }, { ...base, length: 1e100 },
  { ...base, length: Number.MAX_SAFE_INTEGER + 1 }, { ...base, length: null }, { ...base, length: '1' },
  { ...base, length: 0 }, { ...base, length: 3 }, { ...base, columns: [] }, { ...base, columns: ['id', 'id'] },
  { ...base, columns: ['id', 7] }, { ...base, columns: null }, { ...base, arrays: {} },
  { ...base, arrays: { id: [0], file: [] } }, { ...base, arrays: { id: [0], file: 'src/a.js' } }];
const loaders = (target, family, manifest, strict = true) => [
  () => loadJsonArrayArtifact(target, family, { manifest, strict }),
  () => collect(loadJsonArrayArtifactRows(target, family, { manifest, strict })),
  ...(family === 'chunk_meta' ? [() => collect(loadChunkMetaRows(target, { manifest, strict, includeCold: false }))] : []),
  ...(family === 'file_meta' ? [() => collect(loadFileMetaRows(target, { manifest, strict }))] : [])
];
try {
  for (const value of malformed) {
    assert.throws(() => inflateColumnarRows(value), { code: 'ERR_ARTIFACT_INVALID' });
    assert.throws(() => iterateColumnarRows(value), { code: 'ERR_ARTIFACT_INVALID' },
      'even a huge length rejects before creating/advancing a row iterator');
  }
  const rows = [{ id: 0, file: 'src/a.js', start: 0, end: 1 },
    { id: 1, file: 'src/b.js', start: 2, end: 3, name: 'late nullable column' }];
  const producer = buildColumnarChunkMetaFromRows(rows);
  assert.deepEqual(inflateColumnarRows(producer), [{ ...rows[0], name: null }, rows[1]]);
  assert.deepEqual([...iterateColumnarRows(producer)], inflateColumnarRows(producer));
  const files = buildFileMetaColumnar(rows.map(row => ({ id: row.id, file: row.file, ext: '.js' })));
  assert.deepEqual(inflateColumnarRows(files), rows.map(row => ({ id: row.id, file: row.file, ext: '.js' })),
    'table-coded producer values and column order remain unchanged');
  const legacy = { arrays: { id: [7, null], file: ['first', 'second'] } };
  assert.deepEqual(inflateColumnarRows(legacy), [{ id: 7, file: 'first' }, { id: null, file: 'second' }]);
  assert.deepEqual(inflateColumnarRows({ format: 'columnar', columns: [], arrays: {}, length: 0 }), []);
  const controls = [
    { label: 'valid-zero', value: buildColumnarChunkMetaFromRows([]), expected: [] },
    { label: 'legacy-omitted', value: { arrays: { id: [7, 8], file: ['first', 'second'] } },
      expected: [{ id: 7, file: 'first' }, { id: 8, file: 'second' }] }
  ];
  for (const family of ['sample', 'chunk_meta', 'file_meta']) for (const compressed of [false, true]) {
    const target = path.join(dir, `${family}-${compressed}`); await fs.mkdir(target);
    const filename = compressed ? 'rows.columnar.json.gz' : 'rows.columnar.json';
    for (const backup of [false, true]) for (const value of [...malformed, producer, files]) {
      await fs.rm(path.join(target, filename), { force: true }); await fs.rm(path.join(target, filename + '.bak'), { force: true });
      const bytes = Buffer.from(JSON.stringify(value));
      await fs.writeFile(path.join(target, filename + (backup ? '.bak' : '')), compressed ? gzipSync(bytes) : bytes);
      const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
        pieces: [{ name: family, path: filename, format: 'columnar' }] };
      for (const load of loaders(target, family, manifest)) {
        if (malformed.includes(value)) await assert.rejects(load, { code: 'ERR_ARTIFACT_INVALID' });
        else assert.equal((await load()).length, rows.length);
      }
    }
    await fs.writeFile(path.join(target, filename), compressed ? gzipSync(JSON.stringify(producer)) : JSON.stringify(producer));
    const wrongCount = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      pieces: [{ name: family, path: filename, format: 'columnar', count: 1 }] };
    for (const load of loaders(target, family, wrongCount)) await assert.rejects(load, { code: 'ERR_ARTIFACT_INVALID' });
    for (const strict of [true, false]) for (const backup of [false, true]) {
      // Trusted mode may relax family validation; malformed physical extents
      // remain inadmissible before the first row on every exported route.
      for (const { label, value, expected } of [...controls,
        { label: 'checksum-valid-invalid-extent', value: { ...base, length: 3 }, expected: null }]) {
        await fs.rm(path.join(target, filename), { force: true });
        await fs.rm(path.join(target, filename + '.bak'), { force: true });
        const encoded = Buffer.from(JSON.stringify(value)), physical = compressed ? gzipSync(encoded) : encoded;
        const physicalPath = path.join(target, filename + (backup ? '.bak' : ''));
        await fs.writeFile(physicalPath, physical);
        const checksum = createHash('sha256').update(physical).digest('hex');
        assert.equal(createHash('sha256').update(await fs.readFile(physicalPath)).digest('hex'), checksum,
          'the physical payload independently satisfies its declared checksum');
        const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
          pieces: [{ name: family, path: filename, format: 'columnar', bytes: physical.length,
            checksum: `sha256:${checksum}`, count: expected ? expected.length : 3 }] };
        for (const load of loaders(target, family, manifest, strict)) {
          if (expected === null) await assert.rejects(load, { code: 'ERR_ARTIFACT_INVALID' }, `${family}/${label}/${strict}/${backup}`);
          else assert.deepEqual(await load(), expected, `${family}/${label}/${strict}/${backup}`);
        }
        if (expected === null) {
          for (const stream of [
            loadJsonArrayArtifactRows(target, family, { manifest, strict }),
            ...(family === 'file_meta' ? [loadFileMetaRows(target, { manifest, strict })] : []),
            ...(family === 'chunk_meta' ? [loadChunkMetaRows(target, { manifest, strict, includeCold: false })] : [])
          ]) {
            try { await assert.rejects(() => stream.next(), { code: 'ERR_ARTIFACT_INVALID' }, 'reject before first yielded row'); }
            finally { await stream.return(); }
          }
        }
      }
    }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('All exported JSON-columnar routes admit envelope/extent/count before rows and preserve actual producer values.');
