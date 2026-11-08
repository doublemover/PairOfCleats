#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { requireBootstrap } from '../../src/shared/bootstrap-readiness.js';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { hashManagedToolFile } from '../../src/shared/managed-tool-file.js';
import { downloadOfficialGitHubRelease } from '../tooling/official-release-download.js';
import { extractArchive } from '../shared/archive-extraction.js';
import { resolveCiJjRecipe } from './jj-recipe.js';

/** A runner-temporary prerequisite for actual SCM fixtures. Never installs into
 * the checkout, a machine prefix or a user's existing command directory. */
export const provisionCiJj = async ({ root = process.cwd(), env = process.env,
  download = downloadOfficialGitHubRelease, extract = extractArchive,
  run = spawnResolvedSubprocess } = {}) => {
  assert.equal(env.CI, 'true', 'Jujutsu CI provisioning needs an explicit CI launch.');
  for (const key of ['RUNNER_TEMP', 'GITHUB_PATH']) {
    assert.ok(path.isAbsolute(env[key] || '') && !/[\r\n]/u.test(env[key]), `${key}: absolute runner path required`);
  }
  assert.ok(isPathWithinRoot(env.GITHUB_PATH, env.RUNNER_TEMP), 'GITHUB_PATH must stay in the runner temporary namespace.');
  const recipe = resolveCiJjRecipe(), work = await fs.mkdtemp(path.join(env.RUNNER_TEMP, 'poc-ci-jj-'));
  const archive = await download({ url: recipe.url, maxBytes: 16 * 1024 * 1024, timeoutMs: 30000 });
  assert.equal(archive.sourceUrl, recipe.url); assert.ok(Buffer.isBuffer(archive.body));
  assert.equal(archive.body.length, recipe.bytes);
  assert.equal(createHash('sha256').update(archive.body).digest('hex'), recipe.sha256, 'Pinned Jujutsu archive checksum mismatch.');
  const archivePath = path.join(work, recipe.filename), installation = path.join(work, 'installation');
  await fs.writeFile(archivePath, archive.body, { flag: 'wx' });
  await extract(archivePath, installation, recipe.archiveType, { maxEntries: 256,
    maxEntryBytes: 64 * 1024 * 1024, maxBytes: 96 * 1024 * 1024 });
  const command = path.join(installation, process.platform === 'win32' ? 'jj.exe' : 'jj');
  assertNoSymlinkPath(installation, command);
  const binarySha256 = hashManagedToolFile(command, 64 * 1024 * 1024);
  if (process.platform !== 'win32') await fs.chmod(command, 0o700);
  const result = await run(command, ['--version'], { cwd: work, env, timeoutMs: 4000, maxOutputBytes: 65536,
    outputMode: 'string', rejectOnNonZeroExit: true, killTree: true, cleanupOnParentExit: true });
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, ''); assert.ok(!result.signal && !result.error);
  assert.ok(!Object.values(result.outputCapture || {}).some(value => value.truncated || value.encodingLoss || value.droppedBytes));
  assert.match(result.stdout.trim(), new RegExp(`^jj ${recipe.version.replaceAll('.', '\\.')}(-[a-f0-9]+)?$`));
  const diagnostics = path.join(root, '.diagnostics');
  assertNoSymlinkPath(root, diagnostics, { allowMissing: true }); await fs.mkdir(diagnostics, { recursive: true });
  const receipt = { schemaVersion: 1, source: env.GITHUB_SHA || null, node: process.version,
    platform: process.platform, arch: process.arch, recipe, command, binarySha256,
    version: result.stdout.trim(), qualification: 'official-pinned-archive-and-original-executable;SCM-sessions-qualified-separately' };
  await fs.writeFile(path.join(diagnostics, 'jj-provisioning.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  await fs.appendFile(env.GITHUB_PATH, installation + '\n');
  return receipt;
};
if (isDirectExecution(import.meta.url)) {
  await requireBootstrap();
  const receipt = await provisionCiJj();
  console.log(JSON.stringify({ version: receipt.version, command: receipt.command, binarySha256: receipt.binarySha256 }));
}
