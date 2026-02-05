import fs from 'node:fs/promises';
import path from 'node:path';
import { loadJsonArrayArtifactRows } from '../../../../src/shared/artifact-io.js';
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
  for await (const _entry of loadJsonArrayArtifactRows(outDir, 'file_meta', {
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

console.log('file-meta streaming memory cap test passed');
