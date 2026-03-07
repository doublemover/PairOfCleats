#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-range-reads-'));
const srcDir = path.join(repoRoot, 'src');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'beta.txt'), 'abcdefghijklmnopqrstuvwxyz');

const chunkMeta = [
  { chunkUid: 'chunk-b', file: 'src/beta.txt', start: 5, end: 20 }
];

const payload = assembleCompositeContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-b' },
  chunkMeta,
  repoRoot,
  indexSignature: 'test',
  maxBytes: 4,
  includeGraph: false,
  includeTypes: false,
  includeRisk: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  includePaths: false,
  depth: 0
});

assert.strictEqual(payload.primary.excerpt, 'fghi');
console.log('context pack range reads test passed');
