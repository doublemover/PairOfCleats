#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveScmProvider } from '../../../src/index/scm/registry.js';

const fixturesRoot = path.resolve('tests/fixtures/scm');
const gitRoot = path.join(fixturesRoot, 'git');
const jjRoot = path.join(fixturesRoot, 'jj');
const bothRoot = path.join(fixturesRoot, 'both');
const noneRoot = path.join(fixturesRoot, 'none');

const canRun = (cmd) => {
  try {
    const result = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    return result.status === 0;
  } catch {
    return false;
  }
};

const gitAvailable = canRun('git');
const jjAvailable = canRun('jj');

if (gitAvailable) {
  const gitSelection = resolveScmProvider({ provider: 'auto', startPath: gitRoot });
  assert.equal(gitSelection.provider, 'git', 'auto should select git when .git exists');
} else {
  console.log('git unavailable; skipping git selection assertion');
}

if (jjAvailable) {
  const jjSelection = resolveScmProvider({ provider: 'auto', startPath: jjRoot });
  assert.equal(jjSelection.provider, 'jj', 'auto should select jj when .jj exists');
} else {
  console.log('jj unavailable; skipping jj selection assertion');
}

const noneSelection = resolveScmProvider({ provider: 'auto', startPath: noneRoot });
assert.equal(noneSelection.provider, 'none', 'auto should fall back to none when no SCM markers exist');

assert.throws(
  () => resolveScmProvider({ provider: 'auto', startPath: bothRoot }),
  /Both \.git and \.jj/,
  'auto should hard-fail when both markers exist'
);

console.log('scm provider selection ok');
