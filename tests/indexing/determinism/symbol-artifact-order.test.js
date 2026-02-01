#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { enqueueSymbolsArtifacts } from '../../../src/index/build/artifacts/writers/symbols.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'symbol-artifact-order');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const makeSymbol = (name, uid, file, symbolId) => ({
  scheme: 'poc',
  symbolId,
  scopedId: `scope:${uid}`,
  symbolKey: `symkey:${name}`,
  qualifiedName: name,
  kindGroup: 'function',
  chunkUid: uid,
  file
});

const chunks = [
  {
    file: 'src/beta.js',
    name: 'Beta',
    kind: 'function',
    chunkUid: 'uid-beta',
    metaV2: {
      file: 'src/beta.js',
      virtualPath: 'src/beta.js',
      chunkUid: 'uid-beta',
      symbol: makeSymbol('Beta', 'uid-beta', 'src/beta.js', 'sym:2')
    }
  },
  {
    file: 'src/alpha.js',
    name: 'Alpha',
    kind: 'function',
    chunkUid: 'uid-alpha',
    metaV2: {
      file: 'src/alpha.js',
      virtualPath: 'src/alpha.js',
      chunkUid: 'uid-alpha',
      symbol: makeSymbol('Alpha', 'uid-alpha', 'src/alpha.js', 'sym:1')
    }
  },
  {
    file: 'src/alpha-extra.js',
    name: 'AlphaExtra',
    kind: 'function',
    chunkUid: 'uid-alpha-extra',
    metaV2: {
      file: 'src/alpha-extra.js',
      virtualPath: 'src/alpha-extra.js',
      chunkUid: 'uid-alpha-extra',
      symbol: makeSymbol('AlphaExtra', 'uid-alpha-extra', 'src/alpha-extra.js', 'sym:1')
    }
  }
];

const writes = [];
const pieceEntries = [];
const enqueueWrite = (label, job) => writes.push({ label, job });
const addPieceFile = (entry, filePath) => pieceEntries.push({ entry, filePath });
const formatArtifactLabel = (value) => value;

await enqueueSymbolsArtifacts({
  state: { chunks },
  outDir,
  maxJsonBytes: null,
  compression: null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
});

for (const { job } of writes) {
  await job();
}

const raw = await fs.readFile(path.join(outDir, 'symbols.jsonl'), 'utf8');
const rows = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const keys = rows.map((row) => [
  row.symbolId || '',
  row.virtualPath || '',
  row.qualifiedName || '',
  row.kindGroup || '',
  row.chunkUid || ''
].join('|'));
const sorted = keys.slice().sort((a, b) => a.localeCompare(b));
assert.deepEqual(keys, sorted, 'expected symbols to be sorted deterministically');
assert.ok(pieceEntries.length > 0, 'expected symbols artifact entry');

console.log('symbol artifact order test passed');
