import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runLspQualificationWorker } from '../../../tools/ci/qualify-lsp-runtime.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { PHPACTOR_POSIX_SHIM, PHPACTOR_WINDOWS_SHIM } from '../../../tools/tooling/approved-artifacts.js';

const { dir } = await prepareIsolatedTestCacheDir('lsp-runtime-artifact-admission');
const tooling = path.join(dir, 'tooling'), bin = path.join(tooling, 'bin');
await fs.mkdir(bin, { recursive: true });
const artifact = path.join(bin, 'phpactor.phar'), marker = path.join(dir, 'command-invoked');
const command = path.join(bin, process.platform === 'win32' ? 'phpactor.cmd' : 'phpactor');
await fs.writeFile(command, process.platform === 'win32'
  ? `@echo off\r\necho invoked>>"${marker}"\r\nexit /b 1\r\n`
  : `#!/bin/sh\nprintf invoked >> '${marker}'\nexit 1\n`, { mode: 0o755 });
const input = { providerId: 'phpactor', repoRoot: dir, toolingConfig: { dir: tooling }, diagnosticsDir: path.join(dir, 'diagnostics') };
for (const state of ['wrong-launcher', 'missing', 'wrong-bytes', ...(process.platform === 'win32' ? [] : ['symlink'])]) {
  if (state === 'missing') await fs.writeFile(command, process.platform === 'win32' ? PHPACTOR_WINDOWS_SHIM : PHPACTOR_POSIX_SHIM);
  if (state === 'wrong-bytes') await fs.writeFile(artifact, 'inert unapproved bytes, never executed');
  if (state === 'symlink') {
    const target = path.join(bin, 'unapproved-target.phar');
    await fs.writeFile(target, 'inert target, never executed');
    await fs.unlink(artifact); await fs.symlink(target, artifact);
  }
  const receipt = await runLspQualificationWorker(input);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, process.platform === 'win32' ? 'unsupported_platform'
    : state === 'wrong-launcher' ? 'runtime_launcher_unproven' : 'runtime_artifact_unproven');
  if (state === 'symlink') assert.match(receipt.artifact.error, /Invalid managed tool file/);
  await assert.rejects(fs.access(marker), { code: 'ENOENT' }, 'unapproved stock bytes cannot reach even a version probe');
  await assert.rejects(fs.access(path.join(dir, 'diagnostics/.lsp-qualification')), { code: 'ENOENT' }, 'admission precedes workspace creation');
}
console.log('Stock runtime admission rejects native Windows or missing/unapproved/symlinked POSIX payloads before executing a command.');
