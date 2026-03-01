#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hydrateStateDefaults } from '../../../src/index/build/build-state/store.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-build-state-current-'));
const buildsRoot = path.join(tempRoot, 'builds');
const buildRoot = path.join(buildsRoot, 'build-1');
await fs.mkdir(buildRoot, { recursive: true });

const currentPath = path.join(buildsRoot, 'current.json');
await fs.writeFile(currentPath, '{invalid-json', 'utf8');

const recovered = await hydrateStateDefaults({}, buildRoot);
assert.equal(recovered.buildId, 'build-1', 'expected buildId fallback from build root name');
assert.equal(path.resolve(recovered.buildRoot), path.resolve(buildRoot), 'expected buildRoot fallback');
assert.equal(recovered.repoRoot, null, 'malformed current pointer should not set repoRoot');
assert.equal(recovered.repo, null, 'malformed current pointer should not set repo metadata');

await fs.writeFile(currentPath, JSON.stringify({
  repo: {
    root: path.join(tempRoot, 'repo'),
    commit: 'abc123'
  }
}), 'utf8');
const hydrated = await hydrateStateDefaults({}, buildRoot);
assert.equal(
  path.resolve(hydrated.repoRoot || ''),
  path.resolve(path.join(tempRoot, 'repo')),
  'expected valid current pointer repo root hydration'
);
assert.equal(hydrated.repo?.commit, 'abc123', 'expected valid current pointer repo metadata hydration');

console.log('build state current pointer fail-open test passed');
