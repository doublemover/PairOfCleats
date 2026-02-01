#!/usr/bin/env node
import { formatShardFileProgress } from '../../../src/shared/bench-progress.js';

const shardByLabel = new Map([['alpha', { index: 2, total: 10 }]]);
const output = formatShardFileProgress({
  shardLabel: 'alpha',
  fileIndex: 5,
  fileTotal: 20,
  pct: 25.0,
  file: 'src/app.js'
}, { shardByLabel, lineTotal: 100 });

if (!output.includes('[shard 2/10]')) {
  console.error('bench progress format test failed: missing shard index');
  process.exit(1);
}
if (!output.includes('5/20')) {
  console.error('bench progress format test failed: missing file counts');
  process.exit(1);
}
if (!output.includes('lines 100')) {
  console.error('bench progress format test failed: missing line count');
  process.exit(1);
}
if (!output.includes('src/app.js')) {
  console.error('bench progress format test failed: missing file path');
  process.exit(1);
}

console.log('bench progress format test passed');
