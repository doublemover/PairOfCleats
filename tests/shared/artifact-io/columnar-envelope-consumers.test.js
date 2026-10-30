import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { inflateColumnarRows, iterateColumnarRows } from '../../../src/shared/artifact-io/columnar-rows.js';
import { buildColumnarChunkMetaFromRows } from '../../../src/index/build/artifacts/writers/chunk-meta/iterator.js';
import { buildFileMetaColumnar } from '../../../src/index/build/artifacts/file-meta.js';
import { loadJsonArrayArtifact, loadJsonArrayArtifactRows, loadFileMetaRows } from '../../../src/shared/artifact-io/loaders.js';
import { loadChunkMetaRows } from '../../../src/shared/artifact-io/loaders/chunk-meta.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('columnar-envelope-consumers');
const collect = async rows => { const out = []; for await (const row of rows) out.push(row); return out; };
const base = { format: 'columnar', columns: ['id', 'file'], arrays: { id: [0], file: ['src/a.js'] }, length: 1 };
const malformed = [null, {}, { ...base, length: -1 }, { ...base, length: 1.5 }, { ...base, length: 1e100 },
  { ...base, length: Number.MAX_SAFE_INTEGER + 1 }, { ...base, length: null }, { ...base, length: '1' },
  { ...base, length: 0 }, { ...base, length: 3 }, { ...base, columns: [] }, { ...base, columns: ['id', 'id'] },
  { ...base, columns: ['id', 7] }, { ...base, columns: null }, { ...base, arrays: {} },
  { ...base, arrays: { id: [0], file: [] } }, { ...base, arrays: { id: [0], file: 'src/a.js' } }];
const loaders = (target, family, manifest) => [
  () => loadJsonArrayArtifact(target, family, { manifest }),
  () => collect(loadJsonArrayArtifactRows(target, family, { manifest })),
  ...(family === 'chunk_meta' ? [() => collect(loadChunkMetaRows(target, { manifest, includeCold: false }))] : []),
  ...(family === 'file_meta' ? [() => collect(loadFileMetaRows(target, { manifest }))] : [])
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
  assert.deepEqual(inflateColumnarRows(files).map(row => row.file), rows.map(row => row.file), 'table-coded producer values remain unchanged');
  const legacy = { arrays: { id: [7, null], file: ['first', 'second'] } };
  assert.deepEqual(inflateColumnarRows(legacy), [{ id: 7, file: 'first' }, { id: null, file: 'second' }]);
  assert.deepEqual(inflateColumnarRows({ format: 'columnar', columns: [], arrays: {}, length: 0 }), []);
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
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('All exported JSON-columnar routes admit envelope/extent/count before rows and preserve actual producer values.');
