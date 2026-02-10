import fs from 'node:fs/promises';
import path from 'node:path';
import { loadFileMetaRows } from '../../../../src/shared/artifact-io.js';
import { buildFileMetaColumnar } from '../../../../src/index/build/artifacts/file-meta.js';
import { writeJsonLinesFile } from '../../../../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'file-meta-streaming-memory');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const rows = Array.from({ length: 64 }, (_value, index) => ({
  id: index,
  file: `src/file-${index}.js`,
  ext: 'js',
  extra: 'x'.repeat(256)
}));

const jsonlPath = path.join(outDir, 'file_meta.jsonl');
await writeJsonLinesFile(jsonlPath, rows);

let threw = false;
try {
  for await (const _entry of loadFileMetaRows(outDir, {
    strict: false,
    maxBytes: 256
  })) {
    // consume
  }
} catch (err) {
  threw = err?.code === 'ERR_JSON_TOO_LARGE';
}

if (!threw) {
  console.error('file-meta streaming memory cap failed: expected ERR_JSON_TOO_LARGE.');
  process.exit(1);
}

const fallbackDir = path.join(root, '.testCache', 'file-meta-streaming-fallback');
await fs.rm(fallbackDir, { recursive: true, force: true });
await fs.mkdir(fallbackDir, { recursive: true });

const fallbackRows = Array.from({ length: 4 }, (_value, index) => ({
  id: index,
  file: `src/file-${index}.js`,
  ext: 'js'
}));
const fallbackJsonlPath = path.join(fallbackDir, 'file_meta.jsonl');
await writeJsonLinesFile(fallbackJsonlPath, fallbackRows);

const columnarPayload = buildFileMetaColumnar(fallbackRows);
columnarPayload.padding = 'x'.repeat(4096);
const columnarJson = JSON.stringify(columnarPayload);
const jsonlBytes = Buffer.byteLength(
  fallbackRows.map((row) => JSON.stringify(row)).join('\n'),
  'utf8'
);
const columnarBytes = Buffer.byteLength(columnarJson, 'utf8');
const maxBytes = jsonlBytes + 4;
if (columnarBytes <= maxBytes) {
  console.error('file-meta streaming fallback failed: columnar payload too small for test.');
  process.exit(1);
}
await fs.writeFile(path.join(fallbackDir, 'file_meta.columnar.json'), columnarJson);
await fs.writeFile(
  path.join(fallbackDir, 'file_meta.meta.json'),
  JSON.stringify({ format: 'columnar', parts: ['file_meta.columnar.json'] })
);

let fallbackCount = 0;
for await (const _entry of loadFileMetaRows(fallbackDir, {
  strict: false,
  maxBytes
})) {
  fallbackCount += 1;
}
if (fallbackCount !== fallbackRows.length) {
  console.error('file-meta streaming fallback failed: expected JSONL fallback rows.');
  process.exit(1);
}

console.log('file-meta streaming memory cap test passed');
