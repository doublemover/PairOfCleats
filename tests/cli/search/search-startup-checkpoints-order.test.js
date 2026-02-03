#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureFixtureIndex, runSearch } from '../../helpers/fixture-index.js';

process.env.PAIROFCLEATS_TESTING = '1';

const { fixtureRoot, env } = await ensureFixtureIndex({ fixtureName: 'sample' });
const payload = runSearch({
  fixtureRoot,
  env,
  query: 'alpha',
  args: ['--stats'],
  mode: 'code'
});

const stages = Array.isArray(payload?.stats?.pipeline)
  ? payload.stats.pipeline.map((entry) => entry.stage)
  : [];

const indexOf = (name) => stages.indexOf(name);

assert.ok(indexOf('startup.backend') >= 0, 'missing startup.backend');
assert.ok(indexOf('startup.dictionary') >= 0, 'missing startup.dictionary');
assert.ok(indexOf('startup.query-plan') >= 0, 'missing startup.query-plan');
assert.ok(indexOf('startup.indexes') >= 0, 'missing startup.indexes');
assert.ok(indexOf('startup.search') >= 0, 'missing startup.search');

assert.ok(indexOf('startup.backend') < indexOf('startup.dictionary'), 'backend should precede dictionary');
assert.ok(indexOf('startup.dictionary') < indexOf('startup.query-plan'), 'dictionary should precede query plan');
assert.ok(indexOf('startup.query-plan') < indexOf('startup.indexes'), 'query plan should precede indexes');
assert.ok(indexOf('startup.indexes') < indexOf('filter'), 'indexes should precede filter stage');

console.log('search startup checkpoints order test passed');
