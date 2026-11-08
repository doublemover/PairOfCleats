#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { admitBazelLabel, createBazelPackageIndex } from '../../../src/index/build/import-resolution/bazel-label.js';

const importerRel = 'app/rules.bzl';
const admit = label => admitBazelLabel(label, { importerRel });
assert.equal(admit('//tools:defs.bzl').targetOrigin, 'explicit');
assert.equal(admit('//tools/pkg').target, 'pkg');
assert.equal(admit('//tools/pkg').labelRole, 'configured-target');
assert.equal(admit('//tools/pkg:defs').target, 'defs');
assert.equal(admit('//:root.bzl').package, '');
for (const label of ['//tools:../other.bzl', '//tools:./defs.bzl', '//tools:a//defs.bzl',
  '//tools//sub:defs.bzl', '//tools/...:defs.bzl', '//tools:defs.bzl/', '//tools:defs\\.bzl',
  ' //tools:defs.bzl', '//tools:defs.bzl\n', '//tools:']) {
  assert.equal(admit(label).state, 'malformed', label);
}
for (const label of ['//tools:defs.bzl#fragment', '//tools:defs.bzl?query']) {
  assert.equal(admit(label).state, 'unsupported', label);
}
assert.equal(admit('@@canonical+name//tools:defs.bzl').repositoryMapping, 'canonical-unavailable');
assert.equal(admit('@repo//tools:defs.bzl').repositoryMapping, 'apparent-unavailable');
assert.equal(admitBazelLabel('//cdn.example.com/app.js', { importerRel: 'app.js' }).state, 'not-label');
assert.equal(admitBazelLabel('@scope/package', { importerRel: 'app.js' }).state, 'not-label');

const entries = ['BUILD', 'root.bzl', 'app/BUILD', 'app/rules.bzl', 'app/local.bzl',
  'tools/BUILD.bazel', 'tools/defs.bzl', 'tools/tools.bzl', 'tools/pkg.bzl',
  'tools/pkg/BUILD', 'tools/pkg/pkg.bzl', 'tools/pkg/defs.bzl', 'tools/plain/defs.bzl',
  'app/nested/rules.bzl'];
const references = { [importerRel]: ['//tools:missing.bzl', '//tools:plain/defs.bzl', '//tools:pkg/defs.bzl'],
  'app/nested/rules.bzl': [':local.bzl'] };
const rootAbs = path.resolve('bazel-label-owned-fixture');
const makeIndex = ({ paths = entries, metadata = null, errorDirectories = [], reverse = false } = {}) => {
  let calls = 0;
  const current = new Set(metadata || paths);
  const index = createBazelPackageIndex({ rootAbs, entries: reverse ? [...paths].reverse() : paths, references,
    fsMemo: { statProbeSync(absolute) {
      calls++;
      const rel = path.relative(rootAbs, absolute).replace(/\\/g, '/');
      if (errorDirectories.some(dir => path.posix.dirname(rel) === dir)) return { state: 'error', errorCode: 'EACCES' };
      return current.has(rel) ? { state: 'present', stat: { isFile: true, size: 1, mtimeMs: 1 } }
        : { state: 'missing' };
    } } });
  return { index, calls: () => calls };
};
const prepared = makeIndex();
const classify = (label, source = importerRel) => prepared.index.classify(label, { importerRel: source });
assert.equal(classify('//tools:defs.bzl').resolvedPath, 'tools/defs.bzl');
assert.deepEqual(classify('//tools:missing.bzl').candidates, ['tools/missing.bzl']);
assert.equal(classify('//tools:missing.bzl').state, 'target-missing');
assert.equal(classify('//tools:../root.bzl').state, 'malformed');
assert.equal(classify('//tools/pkg').state, 'configured-target-unsupported');
assert.equal(classify('//tools/pkg:defs').state, 'configured-target-unsupported');
assert.equal(classify('//tools/pkg:defs.bzl').resolvedPath, 'tools/pkg/defs.bzl');
assert.equal(classify('//tools:plain/defs.bzl').resolvedPath, 'tools/plain/defs.bzl');
assert.equal(classify('//tools:pkg/defs.bzl').state, 'target-package-mismatch');
assert.equal(classify(':local.bzl', 'app/nested/rules.bzl').resolvedPath, 'app/local.bzl');
assert.equal(classify('//:root.bzl').resolvedPath, 'root.bzl');
assert.equal(classify('@repo//tools:defs.bzl').state, 'repository-unavailable');
const calls = prepared.calls();
for (let i = 0; i < 50; i++) classify('//tools:missing.bzl');
assert.equal(prepared.calls(), calls, 'classification must not probe or rescan');
assert.equal(prepared.index.getStats().entriesVisited, entries.length);
assert.ok(prepared.index.getStats().metadataProbes <= prepared.index.getStats().preparedPackages * 2);
assert.equal(makeIndex({ reverse: true }).index.fingerprint, prepared.index.fingerprint);

const filtered = createBazelPackageIndex({ entries: entries.filter(file => !file.endsWith('BUILD') && !file.endsWith('BUILD.bazel')) });
assert.equal(filtered.classify('//tools:defs.bzl', { importerRel }).state, 'package-unknown');
const unknown = makeIndex({ errorDirectories: ['tools'] });
assert.equal(unknown.index.classify('//tools:defs.bzl', { importerRel }).packageExists, null);
const removedBuild = makeIndex({ metadata: entries.filter(file => file !== 'tools/BUILD.bazel') });
assert.equal(removedBuild.index.classify('//tools:defs.bzl', { importerRel }).state, 'package-missing');
assert.notEqual(removedBuild.index.fingerprint, prepared.index.fingerprint, 'owned BUILD observations invalidate cached meaning');
const changedBoundary = makeIndex({ metadata: [...entries, 'tools/plain/BUILD'] });
assert.equal(changedBoundary.index.classify('//tools:plain/defs.bzl', { importerRel }).state, 'target-package-mismatch');
assert.notEqual(changedBoundary.index.fingerprint, prepared.index.fingerprint);
const mutable = [...entries];
const captured = createBazelPackageIndex({ entries: mutable });
mutable.push('tools/missing.bzl');
assert.equal(captured.classify('//tools:missing.bzl', { importerRel }).state, 'target-missing');
const capped = createBazelPackageIndex({ entries: ['app/BUILD', ...Array.from({ length: 4100 }, (_, n) => `p${n}/defs.bzl`)] });
assert.equal(capped.getStats().exhausted, true);
assert.ok(capped.getStats().preparedPackages <= 4096);
assert.equal(capped.classify('//unprepared:defs.bzl', { importerRel }).state, 'package-unknown');
console.log('bazel label identity test passed');
