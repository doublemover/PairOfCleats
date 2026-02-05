#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-seed-'));
const srcDir = path.join(repoRoot, 'src');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'alpha.js'), 'console.log("alpha");\n');

const chunkMeta = [
  { chunkUid: 'chunk-alpha', file: 'src/alpha.js', start: 0, end: 10 }
];

const payload = assembleCompositeContextPack({
  seed: { type: 'file', path: 'src\\alpha.js' },
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

assert.strictEqual(payload.primary.file, 'src/alpha.js');
console.log('context pack seed normalization test passed');
