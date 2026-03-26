#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { getCombinedOutput } from '../../helpers/stdio.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'legacy-entrypoint-symlink-contract');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const makeSymlink = async (target, linkPath) => {
  try {
    await fs.symlink(target, linkPath, 'file');
    return true;
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'UNKNOWN') {
      return false;
    }
    throw error;
  }
};

const searchLink = path.join(tempRoot, 'search-link.js');
const buildLink = path.join(tempRoot, 'build-index-link.js');
const searchLinked = await makeSymlink(path.join(root, 'search.js'), searchLink);
const buildLinked = await makeSymlink(path.join(root, 'build_index.js'), buildLink);
if (!searchLinked || !buildLinked) {
  console.log('legacy entrypoint symlink contract skipped (symlink creation unavailable)');
  process.exit(0);
}

const env = { ...process.env };
delete env.PAIROFCLEATS_TESTING;
delete env.PAIROFCLEATS_SUPPRESS_LEGACY_ENTRYPOINT_WARNING;

const searchResult = spawnSync(process.execPath, [searchLink, '--help'], {
  cwd: root,
  encoding: 'utf8',
  env
});
assert.equal(searchResult.status, 0, `symlinked search.js wrapper failed: ${getCombinedOutput(searchResult, { trim: true })}`);
const searchOutput = getCombinedOutput(searchResult);
assert.match(searchOutput, /\[deprecated\] search\.js/, 'expected symlinked search wrapper to execute legacy warning path');
assert.match(searchOutput, /Usage:/, 'expected symlinked search wrapper to execute CLI help');

const buildResult = spawnSync(process.execPath, [buildLink, '--config-dump', '--json'], {
  cwd: root,
  encoding: 'utf8',
  env
});
assert.equal(buildResult.status, 0, `symlinked build_index.js wrapper failed: ${getCombinedOutput(buildResult, { trim: true })}`);
assert.equal(typeof JSON.parse(buildResult.stdout || '{}'), 'object', 'expected symlinked build wrapper to emit config dump JSON');

console.log('legacy entrypoint symlink contract test passed');
