#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createVfsManifestCollector } from '../../../src/index/build/vfs-manifest-collector.js';
import { enqueueVfsManifestArtifacts } from '../../../src/index/build/artifacts/writers/vfs-manifest.js';
import { compareVfsManifestRows } from '../../../src/index/tooling/vfs.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'vfs-merge-core');
const outDir = path.join(tempRoot, 'out');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const collector = createVfsManifestCollector({
  buildRoot: tempRoot,
  maxBufferRows: 2,
  maxBufferBytes: 1
});

await collector.appendRows([
  { virtualPath: 'b.js', docHash: 'hash-b', containerPath: null, effectiveExt: '.js', languageId: 'js' },
  { virtualPath: 'a.js', docHash: 'hash-a', containerPath: null, effectiveExt: '.js', languageId: 'js' },
  { virtualPath: 'c.js', docHash: 'hash-c', containerPath: null, effectiveExt: '.js', languageId: 'js' },
  { virtualPath: 'd.js', docHash: 'hash-d', containerPath: null, effectiveExt: '.js', languageId: 'js' }
]);

const writes = [];
await enqueueVfsManifestArtifacts({
  outDir,
  mode: 'code',
  rows: collector,
  maxJsonBytes: 1024 * 1024,
  compression: null,
  hashRouting: false,
  enqueueWrite: (_label, fn) => writes.push(fn),
  addPieceFile: () => {},
  formatArtifactLabel: (value) => value
});

for (const write of writes) {
  await write();
}

const jsonlPath = path.join(outDir, 'vfs_manifest.jsonl');
const text = await fs.readFile(jsonlPath, 'utf8');
const rows = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
const sorted = rows.slice().sort(compareVfsManifestRows);
assert.deepEqual(rows, sorted, 'vfs_manifest output should be sorted');

const runDir = path.join(tempRoot, 'vfs_manifest.runs');
await assert.rejects(fs.access(runDir), 'spill runs should be cleaned');

console.log('vfs merge core integration test passed');
