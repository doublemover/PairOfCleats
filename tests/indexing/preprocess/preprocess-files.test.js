#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { preprocessFiles } from '../../../src/index/build/preprocess.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';

const root = process.cwd();
const cacheRoot = path.join(root, '.testCache', 'preprocess');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(path.join(cacheRoot, 'src'), { recursive: true });
await fs.mkdir(path.join(cacheRoot, 'docs'), { recursive: true });
await fs.mkdir(path.join(cacheRoot, 'src', 'site'), { recursive: true });
await fs.mkdir(path.join(cacheRoot, 'docs', 'reference'), { recursive: true });
await fs.mkdir(path.join(cacheRoot, 'logs'), { recursive: true });

await fs.writeFile(path.join(cacheRoot, 'src', 'app.js'), 'const a = 1;\nconst b = 2;\n');
await fs.writeFile(path.join(cacheRoot, 'src', 'app.min.js'), 'var x=1;');
await fs.writeFile(
  path.join(cacheRoot, 'src', 'minified.js'),
  'const x=' + 'a'.repeat(200)
);
await fs.copyFile(
  path.join(root, 'tests', 'fixtures', 'binary', 'sample.png'),
  path.join(cacheRoot, 'src', 'binary.png')
);
await fs.writeFile(path.join(cacheRoot, 'docs', 'readme.md'), '# title\n');
await fs.writeFile(
  path.join(cacheRoot, 'docs', 'reference', 'index.html'),
  '<!doctype html>\n<html>\n  <body>\n    docs prose\n  </body>\n</html>\n'
);
await fs.writeFile(
  path.join(cacheRoot, 'src', 'site', 'index.html'),
  '<!doctype html>\n<html>\n  <body>\n    code-ish\n  </body>\n</html>\n'
);
await fs.writeFile(path.join(cacheRoot, 'logs', 'app.log'), '2024-01-01 12:00:00 started\n');

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
  modes: ['code', 'prose', 'extracted-prose', 'records'],
  ignoreMatcher,
  maxFileBytes: null,
  fileCaps: {},
  fileScan,
  lineCounts: true,
  concurrency: 4
});

const codeEntries = result.entriesByMode.code.map((entry) => entry.rel).sort();
const proseEntries = result.entriesByMode.prose.map((entry) => entry.rel).sort();
const extractedEntries = result.entriesByMode['extracted-prose'].map((entry) => entry.rel).sort();
const recordEntries = result.entriesByMode.records.map((entry) => entry.rel).sort();
assert.deepEqual(codeEntries, ['src/app.js', 'src/site/index.html']);
assert.deepEqual(proseEntries, ['docs/readme.md', 'docs/reference/index.html']);
assert.deepEqual(extractedEntries, ['docs/readme.md', 'docs/reference/index.html', 'src/app.js', 'src/site/index.html']);
assert.deepEqual(recordEntries, ['logs/app.log']);
assert.ok(!codeEntries.includes('logs/app.log'), 'records should not appear in code');
assert.ok(!proseEntries.includes('logs/app.log'), 'records should not appear in prose');
assert.ok(!extractedEntries.includes('logs/app.log'), 'records should not appear in extracted-prose');
const codeSkips = result.skippedByMode.code.map((skip) => skip.reason);
assert.ok(codeSkips.includes('minified'));
assert.ok(codeSkips.includes('binary'));
assert.ok(result.lineCountsByMode.code.get('src/app.js') > 0);

console.log('preprocess-files test passed.');

