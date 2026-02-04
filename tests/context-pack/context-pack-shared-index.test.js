#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assembleCompositeContextPack, buildChunkIndex } from '../../src/context-pack/assemble.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-index-'));
const srcDir = path.join(repoRoot, 'src');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'a.js'), 'console.log("a");\n');

const chunkMeta = [
  { chunkUid: 'chunk-a', file: 'src/a.js', start: 0, end: 5 }
];
const chunkIndex = buildChunkIndex(chunkMeta, { repoRoot });

chunkMeta[0].file = 'src/other.js';

const payload = assembleCompositeContextPack({
  seed: { type: 'file', path: 'src/a.js' },
  chunkMeta,
  chunkIndex,
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

assert.strictEqual(payload.primary.file, 'src/a.js');
console.log('context pack shared index reuse test passed');
