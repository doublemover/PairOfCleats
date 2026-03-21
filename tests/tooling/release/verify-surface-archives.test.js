#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const verifyScript = path.join(root, 'tools', 'release', 'verify-surface.js');
const vscodePackageScript = path.join(root, 'tools', 'package-vscode.js');
const sublimePackageScript = path.join(root, 'tools', 'package-sublime.js');
const { dir: outDir } = await prepareTestCacheDir('release-verify-archives');

runNode([vscodePackageScript, '--smoke'], 'package-vscode smoke', root, process.env, {
  stdio: 'pipe',
  encoding: 'utf8',
  timeoutMs: 30000
});
const vscodeOut = path.join(outDir, 'vscode-install.json');
const vscodeVerify = runNode(
  [verifyScript, '--surface', 'vscode', '--stage', 'install', '--out', vscodeOut],
  'verify-surface vscode:install',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', timeoutMs: 30000 }
);
const vscodePayload = JSON.parse(vscodeVerify.stdout || '{}');
assert.equal(vscodePayload.ok, true, 'expected vscode install verification to succeed');
assert.equal(fs.existsSync(vscodeOut), true, 'expected vscode verification artifact');

runNode([sublimePackageScript, '--smoke'], 'package-sublime smoke', root, process.env, {
  stdio: 'pipe',
  encoding: 'utf8',
  timeoutMs: 30000
});
const sublimeOut = path.join(outDir, 'sublime-install.json');
const sublimeVerify = runNode(
  [verifyScript, '--surface', 'sublime', '--stage', 'install', '--out', sublimeOut],
  'verify-surface sublime:install',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', timeoutMs: 30000 }
);
const sublimePayload = JSON.parse(sublimeVerify.stdout || '{}');
assert.equal(sublimePayload.ok, true, 'expected sublime install verification to succeed');
assert.equal(fs.existsSync(sublimeOut), true, 'expected sublime verification artifact');

console.log('release verify-surface archive test passed');
