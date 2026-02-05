#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-range-'));
const srcDir = path.join(repoRoot, 'src');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'alpha.txt'), '0123456789');

const chunkMeta = [
  { chunkUid: 'chunk-a', file: 'src/alpha.txt', start: 2, end: 8 }
];

const payload = assembleCompositeContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
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

assert.strictEqual(payload.primary.excerpt, '234567');
console.log('context pack excerpt range test passed');
