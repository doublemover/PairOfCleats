#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { formatShardFileProgress } from '../../../src/shared/bench-progress.js';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'bench/language-repos.js');
const result = spawnSync(process.execPath, [scriptPath, '--list', '--json', '--tier', 'typical'], { encoding: 'utf8' });
if (result.status !== 0) {
  console.error(result.stderr || 'bench-language-repos failed');
  process.exit(result.status ?? 1);
}

const payload = JSON.parse(result.stdout || '{}');
assert.ok(Array.isArray(payload.languages), 'languages array missing');
assert.ok(payload.languages.includes('javascript'), 'javascript language missing');
assert.ok(payload.languages.includes('shell'), 'shell language missing');
assert.ok(Array.isArray(payload.tasks), 'tasks array missing');
assert.ok(payload.tasks.length > 0, 'no benchmark tasks listed');
assert.equal(typeof payload.cloneMirrorCacheRoot, 'string', 'mirror cache root missing from list payload');
assert.equal(
  Number.isFinite(Number(payload.cloneMirrorRefreshMs)),
  true,
  'mirror refresh window missing from list payload'
);

const quietListResult = spawnSync(process.execPath, [scriptPath, '--list', '--quiet', '--tier', 'typical'], {
  encoding: 'utf8'
});
if (quietListResult.status !== 0) {
  console.error(quietListResult.stderr || 'bench-language-repos --quiet --list failed');
  process.exit(quietListResult.status ?? 1);
}
assert.match(
  quietListResult.stderr || '',
  /Benchmark targets/,
  'quiet list output should still print target listing'
);

const languageFilterResult = spawnSync(
  process.execPath,
  [scriptPath, '--list', '--json', '--tier', 'typical', '--language', 'JavaScript / TypeScript'],
  { encoding: 'utf8' }
);
if (languageFilterResult.status !== 0) {
  console.error(languageFilterResult.stderr || 'bench-language-repos --language filter failed');
  process.exit(languageFilterResult.status ?? 1);
}
const languagePayload = JSON.parse(languageFilterResult.stdout || '{}');
assert.ok(Array.isArray(languagePayload.tasks), 'language filter tasks array missing');
assert.ok(languagePayload.tasks.length > 0, 'language filter returned no tasks');
assert.equal(
  languagePayload.tasks.every((task) => String(task.language || '').toLowerCase() === 'javascript'),
  true,
  'language filter should scope tasks to javascript benchmark key'
);

const randomResult = spawnSync(
  process.execPath,
  [scriptPath, '--list', '--json', '--tier', 'typical', '--random'],
  { encoding: 'utf8' }
);
if (randomResult.status !== 0) {
  console.error(randomResult.stderr || 'bench-language-repos --random failed');
  process.exit(randomResult.status ?? 1);
}
const randomPayload = JSON.parse(randomResult.stdout || '{}');
assert.equal(randomPayload.randomizedOrder, true, 'randomizedOrder flag missing from list payload');
const canonicalOrder = (payload.tasks || []).map((task) => `${task.language}|${task.tier}|${task.repo}`);
const randomOrder = (randomPayload.tasks || []).map((task) => `${task.language}|${task.tier}|${task.repo}`);
assert.equal(
  randomOrder.length,
  canonicalOrder.length,
  'randomized output should preserve task count'
);
assert.deepEqual(
  [...randomOrder].sort(),
  [...canonicalOrder].sort(),
  'randomized output should remain a permutation of canonical tasks'
);

const shardByLabel = new Map([['src', { index: 2, total: 4 }]]);
const progressLine = formatShardFileProgress(
  {
    fileIndex: 175,
    fileTotal: 176,
    pct: 99.4,
    shardLabel: 'src',
    file: 'src/app.js'
  },
  { shardByLabel, lineTotal: 123 }
);
assert.ok(progressLine.startsWith('[shard 2/4] 175/176 (99.4%)'), 'shard prefix missing');
assert.ok(progressLine.includes('lines 123'), 'line count missing');
assert.ok(progressLine.includes('src/app.js'), 'file path missing');
assert.ok(!progressLine.includes('Files '), 'legacy Files label should be removed');

console.log('bench-language-repos test passed.');
