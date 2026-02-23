#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assembleCompositeContextPack,
  clearContextPackCaches
} from '../../src/context-pack/assemble.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-fd-zero-'));
const srcDir = path.join(repoRoot, 'src');
fs.mkdirSync(srcDir, { recursive: true });
const filePath = path.join(srcDir, 'alpha.txt');
const filePathLower = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
fs.writeFileSync(filePath, '0123456789');

const chunkMeta = [
  { chunkUid: 'chunk-a', file: 'src/alpha.txt' }
];

const originalOpenSync = fs.openSync;
const originalReadSync = fs.readSync;
const originalCloseSync = fs.closeSync;
const sample = Buffer.from('0123456789', 'utf8');
let closedFdZero = false;

try {
  clearContextPackCaches();

  fs.openSync = (targetPath, ...args) => {
    const resolved = path.resolve(String(targetPath));
    const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (normalized === filePathLower) return 0;
    return originalOpenSync.call(fs, targetPath, ...args);
  };

  fs.readSync = (fd, buffer, offset, length, position) => {
    if (fd === 0) {
      const start = Number.isFinite(position) ? Math.max(0, Math.floor(position)) : 0;
      const end = Math.min(sample.length, start + length);
      const slice = sample.subarray(start, end);
      slice.copy(buffer, offset);
      return slice.length;
    }
    return originalReadSync.call(fs, fd, buffer, offset, length, position);
  };

  fs.closeSync = (fd) => {
    if (fd === 0) {
      closedFdZero = true;
      return;
    }
    return originalCloseSync.call(fs, fd);
  };

  const payload = assembleCompositeContextPack({
    seed: { type: 'chunk', chunkUid: 'chunk-a' },
    chunkMeta,
    repoRoot,
    indexSignature: 'test',
    maxBytes: 128,
    includeGraph: false,
    includeTypes: false,
    includeRisk: false,
    includeImports: false,
    includeUsages: false,
    includeCallersCallees: false,
    includePaths: false,
    depth: 0
  });

  assert.equal(payload.primary.excerpt, '0123456789');
  assert.equal(closedFdZero, true, 'expected fd=0 to be closed in finally path');
} finally {
  fs.openSync = originalOpenSync;
  fs.readSync = originalReadSync;
  fs.closeSync = originalCloseSync;
  clearContextPackCaches();
}

console.log('context pack fd zero close test passed');
