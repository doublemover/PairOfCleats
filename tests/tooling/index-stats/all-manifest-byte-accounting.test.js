import assert from 'node:assert/strict';
import { accumulateManifestBytes, summarizeManifestBytes } from '../../../tools/index/stats-artifacts.js';
const pieces = [{ name: 'chunk_meta', path: 'chunks.json', bytes: 100 },
  { name: 'file_meta', path: 'files.json', bytes: 17 }, { name: 'uncategorized', path: 'other.bin', bytes: 33 },
  { name: 'alias', path: './other.bin', bytes: 33 }];
const physical = accumulateManifestBytes(new Map(), process.cwd(), pieces);
assert.deepEqual(summarizeManifestBytes(physical), { pieces: 3, unknownPieces: 0, bytes: 150 });
accumulateManifestBytes(physical, process.cwd(), [{ path: 'unknown.bin' }]);
assert.deepEqual(summarizeManifestBytes(physical), { pieces: 4, unknownPieces: 1, bytes: null });
console.log('Index byte totals include each physical manifested payload exactly once.');
