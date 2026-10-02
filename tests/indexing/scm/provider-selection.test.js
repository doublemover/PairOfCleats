#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveScmProvider } from '../../../src/index/scm/registry.js';

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-scm-fixtures-'));
const gitRoot = path.join(tempRoot, 'git');
const jjRoot = path.join(tempRoot, 'jj');
const bothRoot = path.join(tempRoot, 'both');
const noneRoot = path.join(tempRoot, 'none');

await fsPromises.mkdir(path.join(gitRoot, '.git'), { recursive: true });
await fsPromises.mkdir(path.join(jjRoot, '.jj'), { recursive: true });
await fsPromises.mkdir(path.join(bothRoot, '.git'), { recursive: true });
await fsPromises.mkdir(path.join(bothRoot, '.jj'), { recursive: true });
await fsPromises.mkdir(noneRoot, { recursive: true });

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

// Sandbox/temp roots can themselves contain a .git marker. Scope marker probes
// to this fixture so the no-SCM and JJ-only cases do not inherit an outer repo.
const existsSync = fs.existsSync;
fs.existsSync = (candidate) => {
  const absolute = path.resolve(String(candidate));
  const marker = path.basename(absolute);
  const relative = path.relative(tempRoot, absolute);
  const outsideFixture = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if ((marker === '.git' || marker === '.jj') && outsideFixture) return false;
  return existsSync(candidate);
};

try {
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
} finally {
  fs.existsSync = existsSync;
}

console.log('scm provider selection ok');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
