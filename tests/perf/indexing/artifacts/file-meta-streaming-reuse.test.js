import fs from 'node:fs/promises';
import path from 'node:path';
import { loadFileMetaRows } from '../../../../src/shared/artifact-io.js';
import { writePiecesManifest } from '../../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'file-meta-streaming-reuse');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const rows = Array.from({ length: 16 }, (_value, index) => ({
  id: index,
  file: `src/file-${index}.js`,
  ext: 'js'
}));

const jsonPath = path.join(outDir, 'file_meta.json');
await fs.writeFile(jsonPath, JSON.stringify(rows));
await writePiecesManifest(outDir, [
  { name: 'file_meta', path: 'file_meta.json', format: 'json' }
]);

const streamed = [];
for await (const entry of loadFileMetaRows(outDir, {
  strict: false,
  materialize: true
})) {
  streamed.push(entry);
}

if (streamed.length !== rows.length) {
  console.error('file-meta streaming reuse failed: materialized length mismatch.');
  process.exit(1);
}

let threw = false;
try {
  for await (const _entry of loadFileMetaRows(outDir, {
    strict: false,
    materialize: false
  })) {
    // consume
  }
} catch (err) {
  threw = true;
}

if (threw) {
  console.error('file-meta streaming reuse failed: materialized JSON should still load.');
  process.exit(1);
}

const invalidDir = path.join(root, '.testCache', 'file-meta-streaming-invalid');
await fs.rm(invalidDir, { recursive: true, force: true });
await fs.mkdir(invalidDir, { recursive: true });
const invalidRows = [
  { id: 0, file: 'src/ok.js', ext: 'js' },
  { file: 'src/missing-id.js', ext: 'js' }
];
await fs.writeFile(path.join(invalidDir, 'file_meta.jsonl'), invalidRows.map((row) => JSON.stringify(row)).join('\n'));
await writePiecesManifest(invalidDir, [
  { name: 'file_meta', path: 'file_meta.jsonl', format: 'jsonl' }
]);
let invalidThrew = false;
try {
  for await (const _entry of loadFileMetaRows(invalidDir, { strict: false })) {
    // consume
  }
} catch (err) {
  invalidThrew = /Invalid file_meta row/.test(err?.message || '');
}
if (!invalidThrew) {
  console.error('file-meta streaming reuse failed: expected row validation error.');
  process.exit(1);
}

console.log('file-meta streaming reuse test passed');
