#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFileScanner } from '../../../src/index/build/file-scan.js';
import { resolvePreReadSkip } from '../../../src/index/build/file-processor/skip.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'file-caps-pre-read');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const abs = path.join(outDir, 'sample.js');
await fs.writeFile(abs, '0123456789', 'utf8');
const fileStat = await fs.lstat(abs);

const fileCaps = {
  default: { maxBytes: 1024, maxLines: null },
  byLanguage: { javascript: { maxBytes: 1, maxLines: null } }
};

const skip = await resolvePreReadSkip({
  abs,
  fileEntry: { abs, rel: 'sample.js' },
  fileStat,
  ext: '.js',
  fileCaps,
  fileScanner: createFileScanner(null),
  runIo: (fn) => fn(),
  languageId: 'javascript',
  mode: 'code',
  maxFileBytes: null
});

assert.ok(skip, 'expected a pre-read skip');
assert.equal(skip.reason, 'oversize');
assert.equal(skip.stage, 'pre-read');
assert.equal(skip.maxBytes, 1);

console.log('file-caps pre-read language cap test passed');

