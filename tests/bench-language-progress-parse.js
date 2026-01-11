#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  parseFileProgressLine,
  parseImportStatsLine,
  parseLineProgress,
  parseProgressLine,
  parseScanMode,
  parseShardLine
} from '../tools/bench/language/progress/parse.js';

const shard = parseShardLine('-> Shard 2/5: python (42 files)');
assert.deepEqual(shard, {
  index: 2,
  total: 5,
  shardLabel: 'python',
  fileCount: 42
});

const importStats = parseImportStatsLine('\u2192 Imports: modules=12, edges=34, files=56');
assert.deepEqual(importStats, { modules: 12, edges: 34, files: 56 });

const combined = parseFileProgressLine('Files 10/100 (10.0%) [shard 2/5] File 3/10 lines 1,234 src/index.js');
assert.equal(combined.count, 10);
assert.equal(combined.total, 100);
assert.equal(combined.pct, 10);
assert.equal(combined.shardLabel, '2/5');
assert.equal(combined.fileIndex, 3);
assert.equal(combined.fileTotal, 10);
assert.equal(combined.file, 'src/index.js');

const fileOnly = parseFileProgressLine('File 7/12 src/lib.rs');
assert.equal(fileOnly.count, null);
assert.equal(fileOnly.total, null);
assert.equal(fileOnly.pct, null);
assert.equal(fileOnly.shardLabel, '');
assert.equal(fileOnly.fileIndex, 7);
assert.equal(fileOnly.fileTotal, 12);
assert.equal(fileOnly.file, 'src/lib.rs');

const progress = parseProgressLine('Files 90/200 (45.0%)');
assert.deepEqual(progress, { step: 'Files', count: 90, total: 200, pct: 45 });

const lineProgress = parseLineProgress('Line 5 / 20');
assert.deepEqual(lineProgress, { current: 5, total: 20 });

assert.equal(parseScanMode('Scanning code'), 'code');
assert.equal(parseScanMode('Scanning prose'), 'prose');

console.log('bench-language progress parse test passed');
