#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCallSites, enqueueCallSitesArtifacts } from '../../../src/index/build/artifacts/writers/call-sites.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'call-sites-manifest');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const chunks = [
  {
    id: 0,
    file: 'alpha.ts',
    lang: 'typescript',
    codeRelations: {
      callDetails: [
        {
          caller: 'alpha',
          callee: 'beta',
          start: 0,
          end: 4,
          startLine: 1,
          startCol: 1,
          endLine: 1,
          endCol: 5,
          args: ['foo']
        },
        {
          caller: 'alpha',
          callee: 'gamma.run',
          start: 10,
          end: 14,
          startLine: 2,
          startCol: 1,
          endLine: 2,
          endCol: 5,
          args: ['bar']
        }
      ]
    }
  }
];

const rows = createCallSites({ chunks });
const lineBytes = rows.length
  ? Math.max(...rows.map((row) => Buffer.byteLength(JSON.stringify(row), 'utf8') + 1))
  : 256;

const writes = [];
const pieceEntries = [];
const enqueueWrite = (label, job) => writes.push({ label, job });
const addPieceFile = (entry, filePath) => pieceEntries.push({ entry, filePath });
const formatArtifactLabel = (value) => value;

await enqueueCallSitesArtifacts({
  state: { chunks },
  outDir,
  maxJsonBytes: lineBytes,
  compression: null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
});

for (const { job } of writes) {
  await job();
}

assert.ok(pieceEntries.length >= 1, 'expected call_sites pieces to be added');
assert.ok(
  pieceEntries.some((piece) => piece.entry?.name === 'call_sites'),
  'expected call_sites entry in manifest pieces'
);
assert.ok(
  pieceEntries.some((piece) => piece.entry?.name === 'call_sites_meta'),
  'expected call_sites_meta entry when sharded'
);

console.log('call_sites manifest test passed');
