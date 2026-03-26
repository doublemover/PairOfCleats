#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildSearchRequestArgs,
  normalizeMetaFilters,
  normalizeMetaJson,
  toList
} from '../../src/shared/search-request.js';

assert.deepEqual(toList(null), []);
assert.deepEqual(toList('alpha'), ['alpha']);
assert.deepEqual(toList(['alpha', 'beta']), ['alpha', 'beta']);

assert.equal(normalizeMetaFilters(null), null);
assert.deepEqual(normalizeMetaFilters({ lang: 'js', flag: '' }), ['lang=js', 'flag']);
assert.deepEqual(normalizeMetaFilters(['x', { y: 2 }, { z: '' }]), ['x', 'y=2', 'z']);
assert.equal(normalizeMetaJson({ alpha: 1 }), '{"alpha":1}');
assert.equal(normalizeMetaJson('{"beta":2}'), '{"beta":2}');

const canonical = buildSearchRequestArgs({
  query: 'needle',
  output: 'compact',
  mode: 'both',
  repoPath: 'C:/repo',
  backend: 'sqlite-fts',
  ann: false,
  allowSparseFallback: true,
  top: -5,
  context: 2,
  path: ['src/**'],
  ext: ['js'],
  meta: [{ lang: 'js' }, 'owner=api'],
  metaJson: { source: 'contract' },
  case: true,
  returns: true
}, {
  includeRepo: true,
  repoPath: 'C:/repo',
  topMin: 0,
  omitModeBoth: true
});

assert.equal(canonical.ok, true);
assert.equal(canonical.query, 'needle');
assert.equal(canonical.output, 'compact');
assert.deepEqual(canonical.args.slice(0, 4), ['--json', '--repo', 'C:/repo', '--compact']);
assert.equal(canonical.args.includes('--mode'), false, 'mode=both should be omitted when omitModeBoth is enabled');
assert.equal(canonical.args.includes('--no-ann'), true);
assert.equal(canonical.args.includes('--allow-sparse-fallback'), true);
assert.equal(canonical.args.includes('--returns'), true);
assert.equal(canonical.args.includes('--case'), true);
assert.deepEqual(
  canonical.args.filter((entry) => entry === '--meta').length,
  2,
  'expected each normalized meta filter to emit its own --meta flag'
);
assert.equal(canonical.args.includes('--meta-json'), true);
assert.deepEqual(
  canonical.args.slice(canonical.args.indexOf('--top'), canonical.args.indexOf('--top') + 2),
  ['--top', '0'],
  'top should clamp to the configured minimum'
);

const invalidSnapshotMix = buildSearchRequestArgs({
  query: 'needle',
  asOf: 'snap-1',
  snapshot: 'snap-2'
});
assert.equal(invalidSnapshotMix.ok, false);
assert.match(invalidSnapshotMix.message, /Cannot combine asOf with snapshot/i);

const conflictingSnapshotIds = buildSearchRequestArgs({
  query: 'needle',
  snapshot: 'snap-1',
  snapshotId: 'snap-2'
});
assert.equal(conflictingSnapshotIds.ok, false);
assert.match(conflictingSnapshotIds.message, /snapshot and snapshotId conflict/i);

const badOutput = buildSearchRequestArgs({
  query: 'needle',
  output: 'wide'
});
assert.equal(badOutput.ok, false);
assert.match(badOutput.message, /Unsupported output mode/i);

console.log('search request contract test passed');
