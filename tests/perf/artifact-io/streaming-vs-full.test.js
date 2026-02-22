import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadJsonArrayArtifact,
  loadJsonArrayArtifactRows,
  resolveBinaryColumnarWriteHints,
  resolveJsonlWriteShapeHints,
  writeBinaryRowFrames
} from '../../../src/shared/artifact-io.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const outDir = await prepareArtifactIoTestDir('artifact-io-streaming', { root });

const rows = Array.from({ length: 256 }, (_value, index) => ({
  id: index,
  name: `entry-${index}`,
  tag: index % 7
}));

const jsonlPath = path.join(outDir, 'symbols.jsonl');
const jsonlHints = resolveJsonlWriteShapeHints({
  estimatedBytes: 2 * 1024 * 1024,
  rowCount: rows.length,
  largeThresholdBytes: 1 * 1024 * 1024,
  maxPresizeBytes: 4 * 1024 * 1024
});
if (!jsonlHints.isLarge || jsonlHints.presizeBytes <= 0) {
  console.error('artifact-io streaming vs full failed: expected large-jsonl shape hints.');
  process.exit(1);
}
await writeJsonLinesFile(jsonlPath, rows, { preallocateBytes: jsonlHints.presizeBytes });
await writePiecesManifest(outDir, [
  { name: 'symbols', path: 'symbols.jsonl' }
]);

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

const binaryHints = resolveBinaryColumnarWriteHints({
  rowCount: rows.length,
  estimatedBytes: 512 * 1024
});
const binaryDataPath = path.join(outDir, 'symbols.binary-columnar.bin');
const binaryOffsetsPath = path.join(outDir, 'symbols.binary-columnar.offsets.bin');
const binaryLengthsPath = path.join(outDir, 'symbols.binary-columnar.lengths.varint');
const binaryFrames = await writeBinaryRowFrames({
  rowBuffers: rows.map((entry) => JSON.stringify(entry)),
  dataPath: binaryDataPath,
  offsetsPath: binaryOffsetsPath,
  lengthsPath: binaryLengthsPath,
  writeHints: binaryHints
});
if (binaryFrames.count !== rows.length) {
  console.error('artifact-io streaming vs full failed: binary row-frame count mismatch.');
  process.exit(1);
}
if (binaryFrames.preallocatedBytes !== binaryHints.preallocateBytes) {
  console.error('artifact-io streaming vs full failed: binary preallocation hint mismatch.');
  process.exit(1);
}
const binaryStat = await fs.stat(binaryDataPath);
if (binaryStat.size !== binaryFrames.totalBytes) {
  console.error('artifact-io streaming vs full failed: binary preallocation truncation mismatch.');
  process.exit(1);
}

console.log('artifact-io streaming vs full test passed');
