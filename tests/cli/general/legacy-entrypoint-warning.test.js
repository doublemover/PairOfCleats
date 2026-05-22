#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const baseEnv = { ...process.env };
delete baseEnv.PAIROFCLEATS_TESTING;
delete baseEnv.PAIROFCLEATS_SUPPRESS_LEGACY_ENTRYPOINT_WARNING;
delete baseEnv.CI;

const searchResult = runNode(
  [path.join(root, 'search.js'), '--help'],
  'legacy search help warning',
  root,
  baseEnv,
  { stdio: 'pipe' }
);
assert.equal(searchResult.status, 0, `search legacy wrapper help failed: ${getCombinedOutput(searchResult, { trim: true })}`);
assert.match(getCombinedOutput(searchResult), /\[deprecated\] search\.js is a legacy compatibility entrypoint\./);
assert.match(getCombinedOutput(searchResult), /Use `pairofcleats search` instead\./);

const buildConfigDump = runNode(
  [path.join(root, 'build_index.js'), '--config-dump', '--json'],
  'legacy build_index config dump',
  root,
  baseEnv,
  { stdio: 'pipe' }
);
assert.equal(
  buildConfigDump.status,
  0,
  `build_index legacy wrapper config dump failed: ${getCombinedOutput(buildConfigDump, { trim: true })}`
);
assert.doesNotMatch(buildConfigDump.stderr || '', /\[deprecated\] build_index\.js/);
assert.equal(typeof JSON.parse(buildConfigDump.stdout || '{}'), 'object', 'expected config dump JSON payload');

const ciSuppressed = runNode(
  [path.join(root, 'search.js'), '--help'],
  'legacy search help warning under CI',
  root,
  { ...baseEnv, CI: '1' },
  { stdio: 'pipe' }
);
assert.equal(ciSuppressed.status, 0, `search legacy wrapper help under CI failed: ${getCombinedOutput(ciSuppressed, { trim: true })}`);
assert.doesNotMatch(getCombinedOutput(ciSuppressed), /\[deprecated\] search\.js is a legacy compatibility entrypoint\./);

console.log('legacy entrypoint warning test passed');
