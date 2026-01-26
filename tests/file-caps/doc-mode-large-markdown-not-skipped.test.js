#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFileScanner } from '../../src/index/build/file-scan.js';
import { resolvePreReadSkip } from '../../src/index/build/file-processor/skip.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'file-caps-doc-mode');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const abs = path.join(outDir, 'doc.md');
await fs.writeFile(abs, 'markdown content', 'utf8');
const fileStat = await fs.lstat(abs);

const fileCaps = {
  default: { maxBytes: 1, maxLines: null },
  byMode: { prose: { maxBytes: 1024 } }
};

const skip = await resolvePreReadSkip({
  abs,
  fileEntry: { abs, rel: 'doc.md' },
  fileStat,
  ext: '.md',
  fileCaps,
  fileScanner: createFileScanner(null),
  runIo: (fn) => fn(),
  languageId: null,
  mode: 'prose',
  maxFileBytes: null
});

assert.equal(skip, null, 'expected prose mode to honor byMode default');

console.log('file-caps prose mode override test passed');

