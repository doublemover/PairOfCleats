import fs from 'node:fs/promises';
import path from 'node:path';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const outDir = await prepareArtifactIoTestDir('artifact-io-streaming-memory', { root });

const rows = Array.from({ length: 128 }, (_value, index) => ({
  id: index,
  payload: 'x'.repeat(128)
}));

const jsonlPath = path.join(outDir, 'symbols.jsonl');
await writeJsonLinesFile(jsonlPath, rows);
await writePiecesManifest(outDir, [
  { name: 'symbols', path: 'symbols.jsonl' }
]);

let threw = false;
try {
  for await (const _entry of loadJsonArrayArtifactRows(outDir, 'symbols', {
    strict: false,
    maxBytes: 256
  })) {
    // consume
  }
} catch (err) {
  threw = err?.code === 'ERR_JSON_TOO_LARGE';
}

if (!threw) {
  console.error('artifact-io streaming memory cap failed: expected ERR_JSON_TOO_LARGE.');
  process.exit(1);
}

console.log('artifact-io streaming memory cap test passed');
