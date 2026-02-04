#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-dedupe-'));
const srcDir = path.join(repoRoot, 'src');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'alpha.txt'), 'same excerpt content');

const chunkMeta = [
  { chunkUid: 'chunk-a', file: 'src/alpha.txt', start: 0, end: 10 }
];

const build = () => assembleCompositeContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  chunkMeta,
  repoRoot,
  includeGraph: false,
  includeTypes: false,
  includeRisk: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  includePaths: false,
  depth: 0
});

const first = build();
const second = build();

assert.strictEqual(second.primary.excerpt, first.primary.excerpt);
assert.strictEqual(second.primary.excerptHash, first.primary.excerptHash);
console.log('context pack excerpt dedupe test passed');
