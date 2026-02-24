#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  resolveBakeoffFastPathDefaults,
  resolveBakeoffBuildPlan,
  resolveBakeoffCurrentBuildRoot,
  resolveBakeoffScriptPaths,
  resolveBakeoffStage4Modes
} from '../../../tools/bench/embeddings/model-bakeoff-lib.js';

const repoRoot = process.cwd();
const toolRoot = process.cwd();

const scripts = resolveBakeoffScriptPaths({ repoRoot, toolRoot });
assert.equal(scripts.buildIndexScript, path.join(repoRoot, 'build_index.js'));
assert.equal(scripts.evalScript, path.join(toolRoot, 'tools', 'eval', 'run.js'));
assert.equal(scripts.compareScript, path.join(toolRoot, 'tools', 'reports', 'compare-models.js'));

const defaultPlan = resolveBakeoffBuildPlan({
  rawArgs: [],
  buildIndex: true,
  buildSqlite: false
});
assert.equal(defaultPlan.buildSqlite, false);
assert.equal(defaultPlan.runStage4OnlyBuild, false);

const explicitStage4OnlyPlan = resolveBakeoffBuildPlan({
  rawArgs: ['--build-sqlite'],
  buildIndex: false,
  buildSqlite: true
});
assert.equal(explicitStage4OnlyPlan.buildSqlite, true);
assert.equal(explicitStage4OnlyPlan.runStage4OnlyBuild, true);

const explicitWithFullBuildPlan = resolveBakeoffBuildPlan({
  rawArgs: ['--build-sqlite'],
  buildIndex: true,
  buildSqlite: true
});
assert.equal(explicitWithFullBuildPlan.buildSqlite, true);
assert.equal(explicitWithFullBuildPlan.runStage4OnlyBuild, false);

const explicitFalsePlan = resolveBakeoffBuildPlan({
  rawArgs: ['--build-sqlite=false'],
  buildIndex: false,
  buildSqlite: false
});
assert.equal(explicitFalsePlan.buildSqlite, false);
assert.equal(explicitFalsePlan.runStage4OnlyBuild, false);

const quickDefaults = resolveBakeoffFastPathDefaults({
  rawArgs: [],
  fullRun: false,
  limit: Number.NaN,
  embeddingSampleFiles: Number.NaN,
  embeddingSampleSeed: '',
  skipCompare: false,
  resume: true
});
assert.equal(quickDefaults.profile, 'quick');
assert.equal(quickDefaults.limit, 20);
assert.equal(quickDefaults.embeddingSampleFiles, 50);
assert.equal(quickDefaults.embeddingSampleSeed, 'quick-smoke');
assert.equal(quickDefaults.skipCompare, true);
assert.equal(quickDefaults.resume, true);

const fullDefaults = resolveBakeoffFastPathDefaults({
  rawArgs: ['--full-run'],
  fullRun: true,
  limit: Number.NaN,
  embeddingSampleFiles: Number.NaN,
  embeddingSampleSeed: '',
  skipCompare: true,
  resume: true
});
assert.equal(fullDefaults.profile, 'full');
assert.equal(fullDefaults.limit, 0);
assert.equal(fullDefaults.embeddingSampleFiles, 0);
assert.equal(fullDefaults.embeddingSampleSeed, 'full-run');
assert.equal(fullDefaults.skipCompare, false);
assert.equal(fullDefaults.resume, false);

const explicitQuickOverridesInFullRun = resolveBakeoffFastPathDefaults({
  rawArgs: [
    '--full-run',
    '--limit',
    '12',
    '--embedding-sample-files',
    '7',
    '--embedding-sample-seed',
    'seeded',
    '--skip-compare',
    '--resume'
  ],
  fullRun: true,
  limit: 12,
  embeddingSampleFiles: 7,
  embeddingSampleSeed: 'seeded',
  skipCompare: true,
  resume: true
});
assert.equal(explicitQuickOverridesInFullRun.limit, 12);
assert.equal(explicitQuickOverridesInFullRun.embeddingSampleFiles, 7);
assert.equal(explicitQuickOverridesInFullRun.embeddingSampleSeed, 'seeded');
assert.equal(explicitQuickOverridesInFullRun.skipCompare, true);
assert.equal(explicitQuickOverridesInFullRun.resume, true);

const explicitNoFlagsWinInQuickRun = resolveBakeoffFastPathDefaults({
  rawArgs: ['--no-skip-compare', '--no-resume'],
  fullRun: false,
  limit: Number.NaN,
  embeddingSampleFiles: Number.NaN,
  embeddingSampleSeed: '',
  skipCompare: false,
  resume: false
});
assert.equal(explicitNoFlagsWinInQuickRun.skipCompare, false);
assert.equal(explicitNoFlagsWinInQuickRun.resume, false);

assert.deepEqual(resolveBakeoffStage4Modes('code'), ['code']);
assert.deepEqual(resolveBakeoffStage4Modes('prose'), ['prose', 'extracted-prose']);
assert.deepEqual(resolveBakeoffStage4Modes('both'), ['code', 'prose', 'extracted-prose', 'records']);
assert.deepEqual(resolveBakeoffStage4Modes('all'), ['code', 'prose', 'extracted-prose', 'records']);

const repoCacheRoot = path.resolve(path.join(process.cwd(), '.testCache', 'model-bakeoff-lib'));
const existingBuildRoot = path.resolve(path.join(repoCacheRoot, 'builds', 'build-001'));
const escapedLinkPath = path.resolve(path.join(repoCacheRoot, 'builds', 'current-link'));
const escapedCanonicalPath = path.resolve(path.join(repoCacheRoot, '..', 'outside-build'));
const buildIdRoot = path.resolve(path.join(repoCacheRoot, 'builds', 'build-002'));
const canonicalMap = new Map([
  [escapedLinkPath, escapedCanonicalPath]
]);
const existsSet = new Set([
  existingBuildRoot,
  escapedCanonicalPath,
  buildIdRoot
]);
const toCanonicalPath = (value) => canonicalMap.get(path.resolve(value)) || path.resolve(value);
const isWithinRoot = (candidate, root) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};
const existsSync = (value) => existsSet.has(path.resolve(value));

assert.equal(
  resolveBakeoffCurrentBuildRoot({
    repoCacheRoot,
    currentState: { buildRoot: 'builds/build-001' },
    existsSync,
    toCanonicalPath,
    isWithinRoot
  }),
  existingBuildRoot,
  'expected in-root buildRoot pointer to resolve'
);

assert.equal(
  resolveBakeoffCurrentBuildRoot({
    repoCacheRoot,
    currentState: { buildRoot: 'builds/current-link' },
    existsSync,
    toCanonicalPath,
    isWithinRoot
  }),
  null,
  'expected canonicalized buildRoot escape to be rejected'
);

assert.equal(
  resolveBakeoffCurrentBuildRoot({
    repoCacheRoot,
    currentState: { buildId: 'build-002' },
    existsSync,
    toCanonicalPath,
    isWithinRoot
  }),
  buildIdRoot,
  'expected buildId fallback to resolve when contained in repo cache'
);

assert.equal(
  resolveBakeoffCurrentBuildRoot({
    repoCacheRoot,
    currentState: { buildId: '../../outside' },
    existsSync,
    toCanonicalPath,
    isWithinRoot
  }),
  null,
  'expected escaped buildId fallback to be rejected'
);

console.log('embedding model bakeoff lib test passed');
