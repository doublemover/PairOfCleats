#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { createTreeSitterSchedulerLookup } from '../../../src/index/build/tree-sitter-scheduler/lookup.js';
import { resolveTreeSitterSchedulerPaths } from '../../../src/index/build/tree-sitter-scheduler/paths.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'scheduler-binary-row-format', 'index-code');
await fs.rm(outDir, { recursive: true, force: true });
const paths = resolveTreeSitterSchedulerPaths(outDir);
await fs.mkdir(paths.resultsDir, { recursive: true });

const grammarKey = 'native:javascript';
const virtualPath = '.poc-vfs/src/example.js#seg:abc.js';
const row = {
  schemaVersion: '1.1.0',
  virtualPath,
  grammarKey,
  segmentRef: 0,
  chunks: [
    {
      start: 0,
      end: 12,
      name: 'example',
      kind: 'FunctionDeclaration'
    }
  ],
  containerPath: 'src/example.js',
  languageId: 'javascript',
  effectiveExt: '.js'
};
const rowJson = JSON.stringify(row);
const payload = Buffer.from(rowJson, 'utf8');
const header = Buffer.allocUnsafe(4);
header.writeUInt32LE(payload.length, 0);
const rowBytes = payload.length + 4;

const resultsPath = paths.resultsPathForGrammarKey(grammarKey, 'binary-v1');
await fs.writeFile(resultsPath, Buffer.concat([header, payload]));
await fs.writeFile(
  paths.resultsIndexPathForGrammarKey(grammarKey),
  `${JSON.stringify({
    schemaVersion: '1.0.0',
    virtualPath,
    grammarKey,
    offset: 0,
    bytes: rowBytes,
    format: 'binary-v1',
    checksum: sha1(rowJson).slice(0, 16)
  })}\n`,
  'utf8'
);

const index = new Map();
index.set(virtualPath, {
  schemaVersion: '1.0.0',
  virtualPath,
  grammarKey,
  offset: 0,
  bytes: rowBytes,
  format: 'binary-v1',
  checksum: sha1(rowJson).slice(0, 16)
});
const lookup = createTreeSitterSchedulerLookup({ outDir, index });
try {
  const loaded = await lookup.loadRow(virtualPath);
  assert.ok(loaded, 'expected row from binary scheduler format');
  assert.equal(loaded.virtualPath, virtualPath, 'virtual path mismatch');
  assert.equal(loaded.grammarKey, grammarKey, 'grammar key mismatch');
  const chunks = await lookup.loadChunks(virtualPath, { consume: false });
  assert.ok(Array.isArray(chunks) && chunks.length === 1, 'expected one chunk');
  assert.ok(lookup.stats().cacheEntries >= 1, 'expected scheduler row cache to retain non-consumed rows');
  const consumed = await lookup.loadChunks(virtualPath);
  assert.ok(Array.isArray(consumed) && consumed.length === 1, 'expected consumed chunk load to succeed');
  assert.equal(lookup.stats().cacheEntries, 0, 'expected consumed chunk load to release row cache');
} finally {
  await lookup.close();
}

const originalOpen = fs.open;
let emfileAttempts = 0;
fs.open = async (...args) => {
  const [targetPath, flags] = args;
  if (String(targetPath) === String(resultsPath) && flags === 'r' && emfileAttempts < 2) {
    emfileAttempts += 1;
    const err = new Error('too many open files');
    err.code = 'EMFILE';
    throw err;
  }
  return originalOpen(...args);
};
try {
  const retryLookup = createTreeSitterSchedulerLookup({ outDir, index });
  try {
    const loaded = await retryLookup.loadRow(virtualPath);
    assert.ok(loaded, 'expected row load to recover after transient EMFILE');
    assert.equal(loaded.virtualPath, virtualPath, 'expected recovered lookup row to match virtual path');
  } finally {
    await retryLookup.close();
  }
} finally {
  fs.open = originalOpen;
}
assert.equal(emfileAttempts, 2, 'expected transient EMFILE path to be exercised');

const grammarKeyTwo = 'native:typescript';
const virtualPathTwo = '.poc-vfs/src/example.ts#seg:def.ts';
const rowTwo = {
  schemaVersion: '1.1.0',
  virtualPath: virtualPathTwo,
  grammarKey: grammarKeyTwo,
  segmentRef: 0,
  chunks: [
    {
      start: 0,
      end: 14,
      name: 'exampleTwo',
      kind: 'FunctionDeclaration'
    }
  ],
  containerPath: 'src/example.ts',
  languageId: 'typescript',
  effectiveExt: '.ts'
};
const rowTwoJson = JSON.stringify(rowTwo);
const rowTwoPayload = Buffer.from(rowTwoJson, 'utf8');
const rowTwoHeader = Buffer.allocUnsafe(4);
rowTwoHeader.writeUInt32LE(rowTwoPayload.length, 0);
const rowTwoBytes = rowTwoPayload.length + 4;
const resultsPathTwo = paths.resultsPathForGrammarKey(grammarKeyTwo, 'binary-v1');
await fs.writeFile(resultsPathTwo, Buffer.concat([rowTwoHeader, rowTwoPayload]));
await fs.writeFile(
  paths.resultsIndexPathForGrammarKey(grammarKeyTwo),
  `${JSON.stringify({
    schemaVersion: '1.0.0',
    virtualPath: virtualPathTwo,
    grammarKey: grammarKeyTwo,
    offset: 0,
    bytes: rowTwoBytes,
    format: 'binary-v1',
    checksum: sha1(rowTwoJson).slice(0, 16)
  })}\n`,
  'utf8'
);

const cappedIndex = new Map(index);
cappedIndex.set(virtualPathTwo, {
  schemaVersion: '1.0.0',
  virtualPath: virtualPathTwo,
  grammarKey: grammarKeyTwo,
  offset: 0,
  bytes: rowTwoBytes,
  format: 'binary-v1',
  checksum: sha1(rowTwoJson).slice(0, 16)
});
const cappedLookup = createTreeSitterSchedulerLookup({
  outDir,
  index: cappedIndex,
  maxOpenReaders: 1
});
try {
  const first = await cappedLookup.loadRow(virtualPath);
  const second = await cappedLookup.loadRow(virtualPathTwo);
  const firstAgain = await cappedLookup.loadRow(virtualPath);
  assert.ok(first && second && firstAgain, 'expected capped reader lookup to load rows across grammars');
  const cappedStats = cappedLookup.stats();
  assert.ok(cappedStats.readerEvictions >= 1, 'expected reader cap to evict old manifest readers');
  assert.ok(cappedStats.openReaders <= 1, 'expected open reader count to respect maxOpenReaders');
} finally {
  await cappedLookup.close();
}

console.log('scheduler binary row format test passed');
