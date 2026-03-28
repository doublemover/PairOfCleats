#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';

const root = process.cwd();
const cliEntryPath = path.join(root, 'tools', 'search', 'cli-entry.js');
const env = applyTestEnv({ syncProcess: false });

const runCli = (args) => spawnSync(process.execPath, [cliEntryPath, ...args], {
  cwd: root,
  encoding: 'utf8',
  env
});

const version = runCli(['--version']);
assert.equal(version.status, 0);
assert.match(stripAnsi(version.stdout), /PairOfCleats Search/);
assert.match(stripAnsi(version.stdout), /v\d+\.\d+\.\d+/);

const invalidMode = runCli(['--mode', 'wat', '--', 'alpha']);
assert.equal(invalidMode.status, 1);
assert.match(stripAnsi(invalidMode.stderr), /Search Error/);
assert.match(stripAnsi(invalidMode.stderr), /code invalid_request/);
assert.match(stripAnsi(invalidMode.stderr), /next choose one of code, prose, both, extracted-prose, records, or all/);
assert.match(stripAnsi(invalidMode.stderr), /Invalid --mode wat/);

const removedFlag = runCli(['--human', '--', 'alpha']);
assert.equal(removedFlag.status, 1);
assert.match(stripAnsi(removedFlag.stderr), /Search Error/);
assert.match(stripAnsi(removedFlag.stderr), /flag --human/);
assert.match(stripAnsi(removedFlag.stderr), /next switch to --json/);

console.log('non-result search surfaces test passed');
