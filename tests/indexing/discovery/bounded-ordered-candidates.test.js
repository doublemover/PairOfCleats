#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { discoverEntries, discoverFilesForModes } from '../../../src/index/build/discover.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';

ensureTestingEnv(process.env);
const root = resolveTestCachePath(process.cwd(), 'discovery-bounded-ordered-candidates');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(path.join(root, 'nested'), { recursive: true });
await fs.mkdir(path.join(root, 'ignored'), { recursive: true });
try {
  // Reverse creation order must not select the fastest stat or filesystem insertion order.
  for (let index = 299; index >= 0; index -= 1) await fs.writeFile(path.join(root, `file-${String(index).padStart(3, '0')}.js`), 'export const n = 1;');
  await fs.writeFile(path.join(root, 'nested', 'deep.js'), 'export const deep = 1;');
  await fs.writeFile(path.join(root, 'ignored', 'keep.js'), 'export const keep = 1;');
  await fs.writeFile(path.join(root, 'ignored', 'drop.js'), 'export const drop = 1;');
  const { ignoreMatcher } = await buildIgnoreMatcher({ root, userConfig: { extraIgnore: ['ignored/**', '!ignored/keep.js'] } });
  const realLstat = fs.lstat;
  fs.lstat = async (target, ...args) => {
    if (String(target).endsWith('file-000.js')) await new Promise(resolve => setTimeout(resolve, 20));
    return realLstat(target, ...args);
  };
  let limited;
  const metrics = {};
  try { limited = await discoverEntries({ root, modes: ['code'], ignoreMatcher, maxFiles: 2, metrics }); }
  finally { fs.lstat = realLstat; }
  assert.deepEqual(limited.entries.map(entry => entry.rel), ['file-000.js', 'file-001.js']);
  assert.equal(metrics.candidateHighWater, 2);
  assert.equal(metrics.directoriesEnumerated, 1, 'accepted cap closes upstream before unrelated directory traversal');
  assert.ok(metrics.sortRowsHighWater <= 256);
  assert.ok(metrics.sortBytesHighWater <= 256 * 1024);
  assert.ok(metrics.scratchBytesHighWater <= 256 * 1024 * 1024);
  assert.ok(metrics.spillBytesWritten > 0, 'wide directory uses existing external merge transport');
  assert.equal(metrics.candidateEnumerationComplete, false, 'early stop is not a complete inventory');

  const allMetrics = {};
  const all = await discoverEntries({ root, modes: ['code'], ignoreMatcher, metrics: allMetrics });
  assert.ok(all.entries.some(entry => entry.rel === 'nested/deep.js'));
  assert.ok(all.entries.some(entry => entry.rel === 'ignored/keep.js'), 'negated descendant remains reachable');
  assert.equal(all.entries.some(entry => entry.rel === 'ignored/drop.js'), false, 'negated traversal does not admit siblings');
  assert.equal(all.entries.filter(entry => entry.rel.startsWith('file-')).length, 300);
  assert.ok(allMetrics.candidateHighWater <= 32);
  assert.equal(allMetrics.candidateEnumerationComplete, true);
  assert.equal(allMetrics.coverageScope, 'filtered-candidates-only', 'candidate scope does not certify filesystem import negatives');
  const shallow = await discoverEntries({ root, modes: ['code'], ignoreMatcher, maxDepth: 0 });
  assert.equal(shallow.entries.some(entry => entry.rel.includes('/')), false);

  let finalized = false;
  let produced = 0;
  const stream = async function* () {
    try {
      for (let index = 0; index < 300; index += 1) { produced += 1; yield `file-${String(index).padStart(3, '0')}.js`; }
    } finally { finalized = true; }
  };
  const streamed = await discoverEntries({ root, modes: ['code'], ignoreMatcher, maxFiles: 2, scmProvider: 'git', scmRepoRoot: root,
    scmProviderImpl: { iterateTrackedFiles: async () => ({ complete: true, files: stream(), ordering: 'utf16-lex' }) } });
  assert.deepEqual(streamed.entries.map(entry => entry.rel), ['file-000.js', 'file-001.js']);
  assert.equal(produced, 2, 'qualified ordered SCM source receives terminal admission upstream');
  assert.equal(finalized, true);
  const empty = await discoverEntries({ root, modes: ['code'], ignoreMatcher, scmProvider: 'git', scmRepoRoot: root,
    scmProviderImpl: { listTrackedFiles: async () => ({ complete: true, filesPosix: [] }) } });
  assert.deepEqual(empty.entries, [], 'empty SCM success stays authoritative');

  const controller = new AbortController(); controller.abort();
  await assert.rejects(discoverEntries({ root, ignoreMatcher, abortSignal: controller.signal }), { name: 'AbortError' });
  const opendir = fs.opendir;
  fs.opendir = async (target, ...args) => {
    if (path.resolve(target) === path.join(root, 'nested')) throw Object.assign(new Error('Denied'), { code: 'EACCES' });
    return opendir(target, ...args);
  };
  try {
    const partial = await discoverEntries({ root, ignoreMatcher });
    assert.equal(partial.metrics.candidateEnumerationComplete, false);
    assert.ok(partial.skippedCommon.some(entry => entry.reason === 'traversal-failed' && entry.code === 'EACCES'));
    await assert.rejects(discoverEntries({ root, ignoreMatcher, strictTraversal: true }), { code: 'EACCES' });
  } finally { fs.opendir = opendir; }
  const routed = await discoverFilesForModes({ root, modes: ['code', 'prose'], ignoreMatcher, maxFiles: 2, skippedByMode: { code: [], prose: [] } });
  assert.equal(routed.code.length, 2); assert.equal(routed.prose.length, 0);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('bounded ordered discovery candidate controls passed');
