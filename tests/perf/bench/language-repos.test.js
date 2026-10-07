#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createBenchLanguageRepoFixture,
  runBenchLanguageRepos
} from './language-repos-fixture.js';

const repoId = 'test/repos-smoke';
const fixture = await createBenchLanguageRepoFixture({
  name: 'bench-language-repos',
  repoId,
  readme: 'bench repos smoke'
});

const result = runBenchLanguageRepos({ fixture, args: ['--json'] });

if (result.status !== 0) {
  console.error(result.stderr || 'bench-language-repos test failed');
  process.exit(result.status ?? 1);
}

const payload = JSON.parse(result.stdout || '{}');
assert.ok(Array.isArray(payload.tasks), 'expected tasks array in bench payload');
assert.equal(payload.tasks.length, 1, 'expected exactly one scheduled bench task');
assert.equal(payload.tasks[0]?.repo, repoId, 'expected synthetic repo task in bench payload');
assert.equal(payload.methodology?.mode, 'warm', 'expected default methodology mode');
assert.equal(payload.methodology?.cacheMode, 'warm', 'expected warm cache methodology default');

const controlSliceResult = runBenchLanguageRepos({
  fixture,
  args: ['--json', '--mode', 'cold', '--control-slice']
});
if (controlSliceResult.status !== 0) {
  console.error(controlSliceResult.stderr || 'bench-language control-slice test failed');
  process.exit(controlSliceResult.status ?? 1);
}
const controlSlicePayload = JSON.parse(controlSliceResult.stdout || '{}');
assert.equal(controlSlicePayload.methodology?.mode, 'cold', 'expected explicit cold methodology mode');
assert.equal(controlSlicePayload.tasks.length, 1, 'expected control slice to keep the representative repo');

console.log('bench-language repos test passed');
