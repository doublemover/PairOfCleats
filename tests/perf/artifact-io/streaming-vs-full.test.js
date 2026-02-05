import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadJsonArrayArtifact,
  loadJsonArrayArtifactRows
} from '../../../src/shared/artifact-io.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'artifact-io-streaming');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const rows = Array.from({ length: 256 }, (_value, index) => ({
  id: index,
  name: `entry-${index}`,
  tag: index % 7
}));

const jsonlPath = path.join(outDir, 'symbols.jsonl');
await writeJsonLinesFile(jsonlPath, rows);

const baseline = await loadJsonArrayArtifact(outDir, 'symbols', { strict: false });
const streamed = [];
for await (const entry of loadJsonArrayArtifactRows(outDir, 'symbols', { strict: false })) {
  streamed.push(entry);
}

if (!Array.isArray(baseline) || baseline.length !== rows.length) {
  console.error('artifact-io streaming vs full failed: baseline length mismatch.');
  process.exit(1);
}
if (streamed.length !== baseline.length) {
  console.error('artifact-io streaming vs full failed: streaming length mismatch.');
  process.exit(1);
}
if (
  streamed[0]?.id !== baseline[0]?.id
  || streamed[streamed.length - 1]?.id !== baseline[baseline.length - 1]?.id
) {
  console.error('artifact-io streaming vs full failed: boundary entries mismatch.');
  process.exit(1);
}

console.log('artifact-io streaming vs full test passed');
