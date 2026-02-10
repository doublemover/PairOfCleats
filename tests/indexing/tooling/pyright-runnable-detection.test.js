#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { __canRunPyrightForTests } from '../../../src/index/tooling/pyright-provider.js';

applyTestEnv();

assert.equal(
  __canRunPyrightForTests('poc-this-command-should-not-exist-9e4a5b8d'),
  false,
  'non-existent command should not be runnable'
);

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-pyright-runnable-'));
const fakeCmd = path.join(tmpDir, 'fake-pyright-bin');
await fs.writeFile(fakeCmd, 'not an executable', 'utf8');

assert.equal(
  __canRunPyrightForTests(fakeCmd),
  false,
  'existing but non-runnable file should fail runnable check'
);

assert.equal(
  __canRunPyrightForTests(process.execPath),
  true,
  'known runnable executable should pass check'
);

await fs.rm(tmpDir, { recursive: true, force: true });

console.log('pyright runnable detection test passed');
