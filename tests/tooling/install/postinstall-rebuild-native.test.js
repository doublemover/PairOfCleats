#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { createPatchFixture, originalText, patchedText } from './patch-fixture.js';

const env = applyTestEnv();
const scriptPath = path.join(process.cwd(), 'tools', 'setup', 'postinstall.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-postinstall-rebuild-'));
const workingRoot = path.join(tempRoot, 'patch %PATH%!runner&cwd');
const markerPath = path.join(workingRoot, 'rebuild-ran.txt');
const run = (extraEnv = {}) => runNode([scriptPath], 'postinstall rebuild native contract', workingRoot, {
  ...env, ...extraEnv
}, { stdio: 'pipe', allowFailure: true, timeoutMs: 30000 });

try {
  const fixture = await createPatchFixture(workingRoot);
  await fs.mkdir(path.join(workingRoot, 'tools', 'setup'), { recursive: true });
  const rebuildScriptPath = path.join(workingRoot, 'tools', 'setup', 'rebuild-native.js');
  await fs.writeFile(rebuildScriptPath, `const fs = require('node:fs');
if (fs.readFileSync(${JSON.stringify(fixture.target)}, 'utf8') !== ${JSON.stringify(patchedText)}) process.exit(9);
fs.appendFileSync(${JSON.stringify(markerPath)}, 'ran\\n');
`);
  assert.equal(run().status, 0, 'clean install should patch before rebuilding');
  assert.equal(run({ npm_config_omit: 'dev' }).status, 0, 'reinstall should work without dev patch tooling');
  assert.equal(await fs.readFile(markerPath, 'utf8'), 'ran\nran\n');

  await fs.writeFile(rebuildScriptPath, 'process.exit(7);\n');
  assert.equal(run().status, 7, 'preserve native rebuild exit codes');
  if (process.platform !== 'win32') {
    await fs.writeFile(rebuildScriptPath, "process.kill(process.pid, 'SIGTERM');\n");
    assert.equal(run().signal, 'SIGTERM', 'preserve native rebuild child signals');
  }

  await fs.writeFile(fixture.target, originalText.replace('old one', 'new one'));
  assert.equal(run().status, 1, 'partial patches must block rebuilding');
  assert.equal(await fs.readFile(markerPath, 'utf8'), 'ran\nran\n');
  console.log('postinstall rebuild native contract test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
