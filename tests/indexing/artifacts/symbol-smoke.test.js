#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createSymbolArtifactChunks,
  runSymbolArtifactWriters
} from './symbols/helpers/symbol-artifact-fixture.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'symbol-artifacts-smoke');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const chunks = createSymbolArtifactChunks();
const { pieceEntries } = await runSymbolArtifactWriters({
  outDir,
  chunks,
  includeSymbols: true,
  includeOccurrences: true,
  includeEdges: true
});

const expectFile = async (relPath) => {
  const absPath = path.join(outDir, relPath);
  await fs.access(absPath);
};

await expectFile('symbols.jsonl');
await expectFile('symbol_occurrences.jsonl');
await expectFile('symbol_edges.jsonl');

const names = new Set(pieceEntries.map((piece) => piece.entry?.name));
assert.ok(names.has('symbols'), 'expected symbols piece');
assert.ok(names.has('symbol_occurrences'), 'expected symbol_occurrences piece');
assert.ok(names.has('symbol_edges'), 'expected symbol_edges piece');

console.log('symbol artifacts smoke test passed');

