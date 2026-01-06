#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { preprocessFiles } from '../src/index/build/preprocess.js';
import { buildIgnoreMatcher } from '../src/index/build/ignore.js';

const root = process.cwd();
const cacheRoot = path.join(root, 'tests', '.cache', 'preprocess');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(path.join(cacheRoot, 'src'), { recursive: true });
await fs.mkdir(path.join(cacheRoot, 'docs'), { recursive: true });

await fs.writeFile(path.join(cacheRoot, 'src', 'app.js'), 'const a = 1;\nconst b = 2;\n');
await fs.writeFile(path.join(cacheRoot, 'src', 'app.min.js'), 'var x=1;');
await fs.writeFile(
  path.join(cacheRoot, 'src', 'minified.js'),
  'const x=' + 'a'.repeat(200)
);
await fs.writeFile(
  path.join(cacheRoot, 'src', 'binary.js'),
  Buffer.from([0, 1, 2, 3, 0, 5, 6, 0])
);
await fs.writeFile(path.join(cacheRoot, 'docs', 'readme.md'), '# title\n');

const { ignoreMatcher } = await buildIgnoreMatcher({ root: cacheRoot, userConfig: {} });
const fileScan = {
  sampleBytes: 256,
  minified: {
    sampleMinBytes: 1,
    minChars: 20,
    avgLineThreshold: 10,
    maxLineThreshold: 10,
    maxWhitespaceRatio: 0.2
  },
  binary: {
    sampleMinBytes: 1,
    maxNonTextRatio: 0.1
  }
};

const result = await preprocessFiles({
  root: cacheRoot,
  modes: ['code', 'prose'],
  ignoreMatcher,
  maxFileBytes: null,
  fileCaps: {},
  fileScan,
  lineCounts: true,
  concurrency: 4
});

const codeEntries = result.entriesByMode.code.map((entry) => entry.rel).sort();
const proseEntries = result.entriesByMode.prose.map((entry) => entry.rel).sort();
assert.deepEqual(codeEntries, ['src/app.js']);
assert.deepEqual(proseEntries, ['docs/readme.md']);
const codeSkips = result.skippedByMode.code.map((skip) => skip.reason);
assert.ok(codeSkips.includes('minified'));
assert.ok(codeSkips.includes('binary'));
assert.ok(result.lineCountsByMode.code.get('src/app.js') > 0);

console.log('preprocess-files test passed.');
