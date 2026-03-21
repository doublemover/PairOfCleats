#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';

const root = process.cwd();
const baseEnv = { ...process.env };
delete baseEnv.PAIROFCLEATS_TESTING;
delete baseEnv.PAIROFCLEATS_SUPPRESS_LEGACY_ENTRYPOINT_WARNING;
delete baseEnv.CI;

const searchResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), '--help'],
  { cwd: root, encoding: 'utf8', env: baseEnv }
);
assert.equal(searchResult.status, 0, `search legacy wrapper help failed: ${getCombinedOutput(searchResult, { trim: true })}`);
assert.match(getCombinedOutput(searchResult), /\[deprecated\] search\.js is a legacy compatibility entrypoint\./);
assert.match(getCombinedOutput(searchResult), /Use `pairofcleats search` instead\./);

const buildConfigDump = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--config-dump', '--json'],
  { cwd: root, encoding: 'utf8', env: baseEnv }
);
assert.equal(
  buildConfigDump.status,
  0,
  `build_index legacy wrapper config dump failed: ${getCombinedOutput(buildConfigDump, { trim: true })}`
);
assert.doesNotMatch(buildConfigDump.stderr || '', /\[deprecated\] build_index\.js/);
assert.equal(typeof JSON.parse(buildConfigDump.stdout || '{}'), 'object', 'expected config dump JSON payload');

console.log('legacy entrypoint warning test passed');
