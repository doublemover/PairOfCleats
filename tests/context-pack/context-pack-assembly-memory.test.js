#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-memory-'));
const srcDir = path.join(repoRoot, 'src');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'mem.js'), 'console.log("mem");');

const chunkMeta = [
  { chunkUid: 'chunk-m', file: 'src/mem.js', start: 0, end: 10 }
];

const payload = assembleCompositeContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-m' },
  chunkMeta,
  repoRoot,
  indexSignature: 'test',
  includeGraph: false,
  includeTypes: false,
  includeRisk: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  includePaths: false,
  depth: 0
});

assert(payload.stats?.memory?.start, 'expected memory start stats');
assert(payload.stats?.memory?.end, 'expected memory end stats');
assert(payload.stats?.memory?.peak, 'expected memory peak stats');
const expectedBytes = Buffer.byteLength(payload.primary.excerpt || '', 'utf8');
assert.strictEqual(payload.stats.excerptBytes, expectedBytes);

console.log('context pack assembly memory test passed');
