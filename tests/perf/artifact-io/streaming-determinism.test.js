import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const outDir = await prepareArtifactIoTestDir('artifact-io-streaming-determinism', { root });

const rows = Array.from({ length: 300 }, (_value, index) => ({
  id: index,
  value: `value-${index % 19}`
}));

const jsonlPath = path.join(outDir, 'symbols.jsonl');
await writeJsonLinesFile(jsonlPath, rows);
await writePiecesManifest(outDir, [
  { name: 'symbols', path: 'symbols.jsonl' }
]);

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
