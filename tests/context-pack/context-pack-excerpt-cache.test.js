#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-excerpt-cache-'));
const srcDir = path.join(repoRoot, 'src');
fs.mkdirSync(srcDir, { recursive: true });
const filePath = path.join(srcDir, 'gamma.txt');
fs.writeFileSync(filePath, 'alpha beta gamma');

const chunkMeta = [
  { chunkUid: 'chunk-g', file: 'src/gamma.txt', start: 0, end: 18 }
];

const first = assembleCompositeContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-g' },
  chunkMeta,
  repoRoot,
  indexSignature: 'test',
  maxTokens: 2,
  includeGraph: false,
  includeTypes: false,
  includeRisk: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  includePaths: false,
  depth: 0
});

fs.writeFileSync(filePath, 'delta epsilon zeta');

const second = assembleCompositeContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-g' },
  chunkMeta,
  repoRoot,
  indexSignature: 'test',
  maxTokens: 2,
  includeGraph: false,
  includeTypes: false,
  includeRisk: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  includePaths: false,
  depth: 0
});

assert.strictEqual(second.primary.excerpt, first.primary.excerpt);
console.log('context pack excerpt cache test passed');
