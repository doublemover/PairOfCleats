#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { createTreeSitterSchedulerLookup } from '../../../src/index/build/tree-sitter-scheduler/lookup.js';
import { resolveTreeSitterSchedulerPaths } from '../../../src/index/build/tree-sitter-scheduler/paths.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'scheduler-binary-row-format', 'index-code');
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

console.log('scheduler binary row format test passed');
