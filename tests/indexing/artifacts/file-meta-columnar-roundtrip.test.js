import { buildFileMeta, buildFileMetaColumnar } from '../../../src/index/build/artifacts/file-meta.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const inflateColumnarRows = (payload) => {
  if (!payload || payload.format !== 'columnar') return null;
  const columns = Array.isArray(payload.columns) ? payload.columns : null;
  const length = Number.isFinite(payload.length) ? payload.length : 0;
  const arrays = payload.arrays && typeof payload.arrays === 'object' ? payload.arrays : null;
  if (!columns || !arrays || !length) return null;
  const tables = payload.tables && typeof payload.tables === 'object' ? payload.tables : null;
  const rows = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const row = {};
    for (const column of columns) {
      const values = arrays[column];
      const value = values ? values[i] : null;
      const table = tables ? tables[column] : null;
      row[column] = table && Number.isInteger(value) ? (table[value] ?? null) : value;
    }
    rows[i] = row;
  }
  return rows;
};

const state = {
  chunks: [
    { file: 'src/a.js', ext: '.js', fileHash: 'hash-a', fileHashAlgo: 'sha1', fileSize: 10 },
    { file: 'src/b.js', ext: '.js', fileHash: 'hash-b', fileHashAlgo: 'sha1', fileSize: 5 }
  ],
  fileInfoByPath: new Map([
    ['src/a.js', { size: 10, hash: 'hash-a', hashAlgo: 'sha1' }],
    ['src/b.js', { size: 5, hash: 'hash-b', hashAlgo: 'sha1' }]
  ])
};

const { fileMeta } = buildFileMeta(state);
const payload = buildFileMetaColumnar(fileMeta);
const inflated = inflateColumnarRows(payload);

if (!Array.isArray(inflated) || inflated.length !== fileMeta.length) {
  fail('Expected columnar file_meta to inflate to the original length.');
}

for (let i = 0; i < fileMeta.length; i += 1) {
  const baseline = fileMeta[i];
  const roundtrip = inflated[i];
  if (baseline.file !== roundtrip.file || baseline.id !== roundtrip.id) {
    fail(`Columnar roundtrip mismatch at index ${i}.`);
  }
  if (baseline.hash !== roundtrip.hash || baseline.hashAlgo !== roundtrip.hashAlgo) {
    fail(`Columnar roundtrip hash mismatch at index ${i}.`);
  }
}

console.log('file meta columnar roundtrip test passed');
