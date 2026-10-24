#!/usr/bin/env node
// Source UNVALIDATED. Future regression executes only the CLI and a sentinel
// that must remain unlaunched; no download/install is requested.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const parent = path.join(process.cwd(), '.tmp', 'tasks', 'install-dry-run-cli-no-probe');
await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'case-'));
try {
  const repo = path.join(root, 'repo'), bin = path.join(root, 'bin'), marker = path.join(root, 'probe-executed');
  await fs.mkdir(repo); await fs.mkdir(bin);
  const sentinel = path.join(bin, 'sentinel.cjs');
  await fs.writeFile(sentinel, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected execution'); console.log('semgrep 1.0.0');\n`);
  if (process.platform === 'win32') await fs.writeFile(path.join(bin, 'semgrep.cmd'), `@echo off\r\n"${process.execPath}" "${sentinel}" %*\r\n`);
  else await fs.writeFile(path.join(bin, 'semgrep'), `#!${process.execPath}\nimport(${JSON.stringify('file://' + sentinel.replaceAll('\\', '/'))});\n`, { mode: 0o755 });
  const env = applyTestEnv({ syncProcess: false, extraEnv: { PAIROFCLEATS_HOME: path.join(root, 'home'),
    PAIROFCLEATS_TOOLING_DIR: path.join(root, 'tools'), PAIROFCLEATS_TRUSTED_REPOS: '', PAIROFCLEATS_TRUSTED_CONFIG: '',
    PATH: bin + path.delimiter + (process.env.PATH || '') } });
  const result = runNode(['tools/tooling/install.js', '--repo', repo, '--tools', 'semgrep', '--scope', 'cache', '--no-fallback', '--dry-run', '--json'],
    'tooling install metadata-only dry run', process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
  assert.equal(result.error, undefined);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.preview.execution, 'none');
  assert.equal(payload.preview.entries[0].location.state, 'located-not-probed');
  assert.equal(payload.readiness.ready, false);
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(repo), [], 'dry run never writes a repository configuration or receipt');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Install dry-run CLI no-probe source fixture completed.');
