import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'artifact-io-streaming-determinism');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const rows = Array.from({ length: 300 }, (_value, index) => ({
  id: index,
  value: `value-${index % 19}`
}));

const jsonlPath = path.join(outDir, 'symbols.jsonl');
await writeJsonLinesFile(jsonlPath, rows);

const hashRows = async () => {
  const hash = crypto.createHash('sha1');
  for await (const entry of loadJsonArrayArtifactRows(outDir, 'symbols', { strict: false })) {
    hash.update(JSON.stringify(entry));
  }
  return hash.digest('hex');
};

const first = await hashRows();
const second = await hashRows();

if (first !== second) {
  console.error('artifact-io streaming determinism failed: hashes differ.');
  process.exit(1);
}

console.log('artifact-io streaming determinism test passed');
