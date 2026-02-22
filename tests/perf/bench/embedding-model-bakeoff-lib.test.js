#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  resolveBakeoffBuildPlan,
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

assert.deepEqual(resolveBakeoffStage4Modes('code'), ['code']);
assert.deepEqual(resolveBakeoffStage4Modes('prose'), ['prose', 'extracted-prose']);
assert.deepEqual(resolveBakeoffStage4Modes('both'), ['code', 'prose', 'extracted-prose', 'records']);
assert.deepEqual(resolveBakeoffStage4Modes('all'), ['code', 'prose', 'extracted-prose', 'records']);

console.log('embedding model bakeoff lib test passed');
