#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { enqueueSymbolEdgesArtifacts } from '../../../../src/index/build/artifacts/writers/symbol-edges.js';
import { enqueueSymbolOccurrencesArtifacts } from '../../../../src/index/build/artifacts/writers/symbol-occurrences.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'symbol-endpoint-integrity');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const validRef = {
  v: 1,
  targetName: 'beta',
  status: 'resolved',
  resolved: {
    symbolId: 'sym:beta',
    chunkUid: 'uid-beta'
  }
};

const chunks = [
  {
    file: 'src/alpha.js',
    chunkUid: 'uid-alpha',
    metaV2: {
      file: 'src/alpha.js',
      chunkUid: 'uid-alpha'
    },
    codeRelations: {
      callLinks: [
        { edgeKind: 'call', to: validRef },
        { edgeKind: 'call', to: { targetName: 'broken-call', status: 'resolved' } }
      ],
      callDetails: [
        { callee: 'beta', calleeRef: validRef, start: 0, end: 3 },
        { callee: 'broken-call', calleeRef: { targetName: 'broken-call', status: 'resolved' }, start: 4, end: 7 }
      ],
      usageLinks: [
        { edgeKind: 'usage', to: { status: 'unresolved' } }
      ]
    }
  }
];

const writes = [];
const enqueueWrite = (_label, job) => writes.push(job);
const addPieceFile = () => {};
const formatArtifactLabel = (value) => value;

await enqueueSymbolEdgesArtifacts({
  state: { chunks },
  outDir,
  maxJsonBytes: null,
  compression: null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
});

await enqueueSymbolOccurrencesArtifacts({
  state: { chunks },
  outDir,
  maxJsonBytes: null,
  compression: null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
});

for (const write of writes) {
  await write();
}

const readJsonl = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
};

const edgeRows = await readJsonl(path.join(outDir, 'symbol_edges.jsonl'));
assert.equal(edgeRows.length, 1, 'expected invalid symbol edge endpoints to be filtered');
assert.equal(edgeRows[0]?.to?.resolved?.chunkUid, 'uid-beta', 'expected valid resolved endpoint to remain');

const occurrenceRows = await readJsonl(path.join(outDir, 'symbol_occurrences.jsonl'));
assert.equal(occurrenceRows.length, 1, 'expected invalid symbol occurrence endpoints to be filtered');
assert.equal(occurrenceRows[0]?.ref?.resolved?.chunkUid, 'uid-beta', 'expected valid occurrence endpoint to remain');

console.log('symbol endpoint integrity test passed');
