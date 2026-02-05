import fs from 'node:fs/promises';
import path from 'node:path';
import { loadJsonArrayArtifactRows } from '../../../../src/shared/artifact-io.js';

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

const streamed = [];
for await (const entry of loadJsonArrayArtifactRows(outDir, 'file_meta', {
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
  for await (const _entry of loadJsonArrayArtifactRows(outDir, 'file_meta', {
    strict: false,
    materialize: false
  })) {
    // consume
  }
} catch (err) {
  threw = /Materialized read required/.test(err?.message || '');
}

if (!threw) {
  console.error('file-meta streaming reuse failed: expected materialize error.');
  process.exit(1);
}

console.log('file-meta streaming reuse test passed');
