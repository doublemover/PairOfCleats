#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { createPatchFixture, originalText, patchedText } from './patch-fixture.js';
import { applyPatches } from '../../../tools/setup/apply-patches.js';

const env = applyTestEnv();
const helper = path.join(process.cwd(), 'tools', 'setup', 'apply-patches.js');
const postinstall = path.join(process.cwd(), 'tools', 'setup', 'postinstall.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-patch-contract-'));
const run = (cwd, script = helper, extraEnv = {}) => runNode([script], 'package patch contract', cwd, {
  ...env, ...extraEnv
}, { stdio: 'pipe', allowFailure: true, timeoutMs: 30000 });
const fails = (result, pattern) => {
  assert.equal(result.status, 1, `Expected failure: ${result.stdout}\n${result.stderr}`);
  if (pattern) assert.match(result.stderr, pattern);
};
const make = async (name, options) => {
  const cwd = path.join(tempRoot, name);
  const fixture = await createPatchFixture(cwd, options);
  return { cwd, ...fixture };
};

try {
  const clean = await make('path with spaces %PATH%!&');
  assert.throws(() => applyPatches(clean.cwd, { verifyOnly: true }), /has not been applied/);
  assert.equal(await fs.readFile(clean.target, 'utf8'), originalText, 'verification never applies a missing patch');
  const invalidGitConfig = path.join(tempRoot, 'invalid.gitconfig');
  await fs.writeFile(invalidGitConfig, '[invalid config\n');
  const cleanResult = run(clean.cwd, helper, { GIT_CONFIG_GLOBAL: invalidGitConfig });
  assert.equal(cleanResult.status, 0, `isolated Git configuration must work: ${cleanResult.stderr}`);
  assert.equal(await fs.readFile(clean.target, 'utf8'), patchedText);
  assert.equal(applyPatches(clean.cwd, { verifyOnly: true }), 1);
  const repeat = run(clean.cwd);
  assert.equal(repeat.status, 0);
  assert.match(repeat.stdout, /already applied/);
  assert.equal(await fs.readFile(clean.target, 'utf8'), patchedText);

  const scoped = await make('scoped', { packageName: '@scope/sample' });
  await fs.writeFile(scoped.target, originalText.replace(/\n/g, '\r\n'));
  await fs.writeFile(scoped.patchFile, scoped.patch.replace(/\n/g, '\r\n'));
  assert.equal(run(scoped.cwd).status, 0);
  assert.equal(await fs.readFile(scoped.target, 'utf8'), patchedText.replace(/\n/g, '\r\n'));
  assert.equal(run(scoped.cwd).status, 0);
  assert.equal(await fs.readFile(scoped.patchFile, 'utf8'), scoped.patch.replace(/\n/g, '\r\n'));

  const partial = await make('partial');
  await fs.writeFile(partial.target, originalText.replace('old one', 'new one'));
  fails(run(partial.cwd), /not fully applied/);
  assert.equal(await fs.readFile(partial.target, 'utf8'), originalText.replace('old one', 'new one'));

  const version = await make('version');
  await fs.writeFile(version.packageJson, JSON.stringify({ name: 'sample', version: '1.0.1' }));
  fails(run(version.cwd), /requires exactly sample@1\.0\.0/);
  assert.equal(await fs.readFile(version.target, 'utf8'), originalText);

  const missing = await make('missing-package');
  await fs.rm(path.dirname(missing.target), { recursive: true });
  fails(run(missing.cwd, postinstall));
  fails(run(missing.cwd, postinstall, { npm_config_omit: 'dev' }));

  const malformed = await make('malformed');
  await fs.writeFile(malformed.patchFile, malformed.patch + '--- a/escape\n+++ b/escape\n@@ -1 +1 @@\n-old\n+new\n');
  fails(run(malformed.cwd), /malformed patch hunk/);
  assert.equal(await fs.readFile(malformed.target, 'utf8'), originalText);

  const traversal = await make('traversal');
  await fs.writeFile(traversal.patchFile, traversal.patch.replaceAll(traversal.relative, 'node_modules/sample/../../escape'));
  fails(run(traversal.cwd), /Unsafe patch path/);
  const windowsPath = await make('windows-path');
  await fs.writeFile(windowsPath.patchFile, windowsPath.patch.replaceAll('source.txt', '..\\escape'));
  fails(run(windowsPath.cwd), /Unsafe patch path/);

  const linked = await make('junction');
  const outside = path.join(tempRoot, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'package.json'), JSON.stringify({ name: 'sample', version: '1.0.0' }));
  await fs.writeFile(path.join(outside, 'source.txt'), originalText);
  await fs.rm(path.dirname(linked.target), { recursive: true });
  await fs.symlink(outside, path.dirname(linked.target), process.platform === 'win32' ? 'junction' : 'dir');
  fails(run(linked.cwd), /regular unlinked directory/);
  assert.equal(await fs.readFile(path.join(outside, 'source.txt'), 'utf8'), originalText);

  const hardlinked = await make('hardlink');
  await fs.rm(hardlinked.target);
  await fs.link(path.join(outside, 'source.txt'), hardlinked.target);
  fails(run(hardlinked.cwd), /regular unlinked file/);

  const allOrNothing = await make('preflight-all', { packageName: 'aaa' });
  const bad = await createPatchFixture(allOrNothing.cwd, { packageName: 'zzz' });
  await fs.writeFile(bad.target, 'incompatible\n');
  fails(run(allOrNothing.cwd), /not fully applied/);
  assert.equal(await fs.readFile(allOrNothing.target, 'utf8'), originalText);

  const oversized = await make('oversized');
  await fs.writeFile(oversized.patchFile, Buffer.alloc(1024 * 1024 + 1, 32));
  fails(run(oversized.cwd), /size limit/);

  const noGit = await make('missing-git');
  const isolatedPath = path.join(tempRoot, 'empty-bin');
  await fs.mkdir(isolatedPath);
  const withoutPath = { ...env };
  for (const key of Object.keys(withoutPath)) if (key.toLowerCase() === 'path') delete withoutPath[key];
  const noGitResult = runNode([helper], 'missing Git fails closed', noGit.cwd, {
    ...withoutPath, PATH: isolatedPath
  }, { stdio: 'pipe', allowFailure: true, timeoutMs: 30000 });
  fails(noGitResult, /required Git patch tool/);
  assert.equal(await fs.readFile(noGit.target, 'utf8'), originalText);

  if (process.platform !== 'win32') {
    const gitStub = path.join(isolatedPath, 'git');
    await fs.writeFile(gitStub, `#!${process.execPath}\nprocess.kill(process.pid, 'SIGTERM');\n`);
    await fs.chmod(gitStub, 0o755);
    const signaled = runNode([postinstall], 'Git signal propagation', noGit.cwd, {
      ...withoutPath, PATH: isolatedPath
    }, { stdio: 'pipe', allowFailure: true, timeoutMs: 30000 });
    assert.equal(signaled.signal, 'SIGTERM', 'preserve Git child signals through postinstall');
    assert.equal(await fs.readFile(noGit.target, 'utf8'), originalText);
  }

  const noPatches = path.join(tempRoot, 'empty');
  await fs.mkdir(noPatches);
  assert.equal(run(noPatches, postinstall).status, 0);
  assert.match(run(noPatches, postinstall).stdout, /no patch files found; skipping patch step/);
  console.log('postinstall patch enforcement test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
