import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import { loadSymbolOccurrencesByFile } from '../../../src/shared/artifact-io/loaders.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const tempRoot = await prepareArtifactIoTestDir('broken-offsets-fallback', { root });

const fileMeta = [
  { id: 0, file: 'src/a.js' },
  { id: 1, file: 'src/b.js' }
];
await fs.writeFile(path.join(tempRoot, 'file_meta.json'), JSON.stringify(fileMeta, null, 2));

const occurrencesPath = path.join(tempRoot, 'symbol_occurrences.jsonl');
await writeJsonLinesFile(occurrencesPath, [
  { v: 1, host: { file: 'src/a.js', chunkUid: 'c1' }, role: 'decl', ref: { name: 'a' } },
  { v: 1, host: { file: 'src/b.js', chunkUid: 'c2' }, role: 'decl', ref: { name: 'b' } }
], { atomic: true });

const perFileMeta = {
  data: 'symbol_occurrences.by-file.bin',
  offsets: { path: 'symbol_occurrences.by-file.offsets.bin' },
  jsonl: {
    parts: ['symbol_occurrences.jsonl'],
    counts: [2],
    offsets: ['symbol_occurrences.jsonl.offsets.bin']
  }
};
await fs.writeFile(
  path.join(tempRoot, 'symbol_occurrences.by-file.meta.json'),
  JSON.stringify(perFileMeta, null, 2)
);
await writePiecesManifest(tempRoot, [
  { name: 'file_meta', path: 'file_meta.json', format: 'json' },
  { name: 'symbol_occurrences', path: 'symbol_occurrences.jsonl' },
  { name: 'symbol_occurrences_by_file_meta', path: 'symbol_occurrences.by-file.meta.json', format: 'json' }
]);

const rows = await loadSymbolOccurrencesByFile(tempRoot, {
  filePath: 'src/a.js',
  strict: false
});
assert.strictEqual(rows.length, 1, 'expected full scan fallback to return rows');
assert.strictEqual(rows[0]?.host?.file, 'src/a.js');
console.log('broken offsets fallback test passed');
