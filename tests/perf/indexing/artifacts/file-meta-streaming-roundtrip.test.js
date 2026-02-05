import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadJsonArrayArtifact,
  loadJsonArrayArtifactRows
} from '../../../../src/shared/artifact-io.js';
import { writeJsonLinesFile } from '../../../../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'file-meta-streaming');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const rows = Array.from({ length: 128 }, (_value, index) => ({
  id: index,
  file: `src/file-${index}.js`,
  ext: 'js'
}));

const jsonlPath = path.join(outDir, 'file_meta.jsonl');
await writeJsonLinesFile(jsonlPath, rows);

const baseline = await loadJsonArrayArtifact(outDir, 'file_meta', { strict: false });
const streamed = [];
for await (const entry of loadJsonArrayArtifactRows(outDir, 'file_meta', { strict: false })) {
  streamed.push(entry);
}

if (!Array.isArray(baseline) || baseline.length !== rows.length) {
  console.error('file-meta streaming roundtrip failed: baseline length mismatch.');
  process.exit(1);
}
if (streamed.length !== baseline.length) {
  console.error('file-meta streaming roundtrip failed: streaming length mismatch.');
  process.exit(1);
}
if (
  streamed[0]?.file !== baseline[0]?.file
  || streamed[streamed.length - 1]?.file !== baseline[baseline.length - 1]?.file
) {
  console.error('file-meta streaming roundtrip failed: boundary entries mismatch.');
  process.exit(1);
}

console.log('file-meta streaming roundtrip test passed');
