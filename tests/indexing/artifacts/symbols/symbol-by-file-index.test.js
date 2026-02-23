#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  loadJsonArrayArtifact,
  loadSymbolOccurrencesByFile,
  loadSymbolEdgesByFile
} from '../../../../src/shared/artifact-io.js';
import {
  createSymbolArtifactChunks,
  runSymbolArtifactWriters
} from './helpers/symbol-artifact-fixture.js';
import { writePiecesManifest } from '../../../helpers/artifact-io-fixture.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'symbol-by-file-index');
const outDir = path.join(tempRoot, 'out');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const chunks = createSymbolArtifactChunks();
const { fileMeta, fileIdByPath } = await runSymbolArtifactWriters({
  outDir,
  chunks,
  includeSymbols: false,
  includeOccurrences: true,
  includeEdges: true,
  useFileIndex: true
});
await writePiecesManifest(outDir, [
  { name: 'symbol_occurrences', path: 'symbol_occurrences.jsonl' },
  { name: 'symbol_edges', path: 'symbol_edges.jsonl' },
  { name: 'symbol_occurrences_by_file_meta', path: 'symbol_occurrences.by-file.meta.json', format: 'json' },
  { name: 'symbol_edges_by_file_meta', path: 'symbol_edges.by-file.meta.json', format: 'json' }
]);

const targetFileId = fileIdByPath.get('src/alpha.js');
assert.ok(Number.isFinite(targetFileId), 'expected fileId for alpha.js');

const allOccurrences = await loadJsonArrayArtifact(outDir, 'symbol_occurrences', { strict: false });
const expectedOccurrences = allOccurrences.filter((row) => row?.host?.file === 'src/alpha.js');
const indexedOccurrences = await loadSymbolOccurrencesByFile(outDir, {
  fileId: targetFileId,
  strict: false
});
assert.deepEqual(indexedOccurrences, expectedOccurrences, 'per-file symbol occurrences should match scan');

const allEdges = await loadJsonArrayArtifact(outDir, 'symbol_edges', { strict: false });
const expectedEdges = allEdges.filter((row) => row?.from?.file === 'src/alpha.js');
const indexedEdges = await loadSymbolEdgesByFile(outDir, {
  fileId: targetFileId,
  strict: false
});
assert.deepEqual(indexedEdges, expectedEdges, 'per-file symbol edges should match scan');

assert.ok(fileMeta.length >= 2, 'expected file_meta entries');
console.log('symbol per-file index test passed');

