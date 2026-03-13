#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createInProcessSearchRunner,
  ensureFixtureIndex,
  ensureFixtureSqlite
} from '../../helpers/fixture-index.js';

const { fixtureRoot, env, userConfig } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'fixture-sample',
  cacheScope: 'shared'
});
await ensureFixtureSqlite({ fixtureRoot, userConfig, env });
const runSearch = createInProcessSearchRunner({ fixtureRoot, env });

const payload = await runSearch({
  query: 'message',
  mode: 'prose',
  args: ['--backend', 'sqlite-fts', '--explain']
});

const proseHit = (payload.prose || [])[0] || null;
assert.ok(proseHit, 'expected prose hit for explain output');
assert.ok(payload.stats?.routingPolicy?.byMode?.prose, 'expected routing policy in explain stats');
assert.ok(payload.stats?.routing?.byMode?.prose, 'expected routing detail alias in explain stats');
assert.ok(payload.stats?.capabilities?.routing, 'expected capability gating outcomes in explain stats');
assert.equal(typeof proseHit.scoreBreakdown?.sparse?.match, 'string', 'expected compiled FTS MATCH in explain');
assert.equal(typeof proseHit.scoreBreakdown?.sparse?.variant, 'string', 'expected FTS variant in explain');
assert.ok(proseHit.scoreBreakdown?.schemaVersion === 1, 'expected score breakdown schema version');

console.log('explain output includes routing and fts match test passed');
