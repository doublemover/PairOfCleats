#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { enqueueSymbolEdgesArtifacts } from '../../../src/index/build/artifacts/writers/symbol-edges.js';
import { compareSymbolEdgeRows } from '../../../src/index/build/artifacts/helpers.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'relations-merge-core');
const outDir = path.join(tempRoot, 'out');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const callLinks = [];
for (let i = 0; i < 6001; i += 1) {
  callLinks.push({
    edgeKind: 'call',
    to: { targetName: `sym-${String(6000 - i).padStart(4, '0')}`, status: 'resolved' }
  });
}

const state = {
  chunks: [{
    file: 'src/a.js',
    chunkUid: 'ck:a',
    metaV2: { file: 'src/a.js', chunkUid: 'ck:a' },
    codeRelations: { callLinks }
  }]
};

const writes = [];
await enqueueSymbolEdgesArtifacts({
  state,
  outDir,
  maxJsonBytes: 1024 * 1024,
  format: null,
  compression: null,
  enqueueWrite: (_label, fn) => writes.push(fn),
  addPieceFile: () => {},
  formatArtifactLabel: (value) => value,
  stageCheckpoints: { record: () => {} }
});

for (const write of writes) {
  await write();
}

const jsonlPath = path.join(outDir, 'symbol_edges.jsonl');
const text = await fs.readFile(jsonlPath, 'utf8');
const rows = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
const sorted = rows.slice().sort(compareSymbolEdgeRows);
assert.deepEqual(rows, sorted, 'symbol_edges output should be sorted');

const runDir = path.join(outDir, 'symbol_edges.runs');
await assert.rejects(fs.access(runDir), 'spill runs should be cleaned');

console.log('relations merge core integration test passed');
