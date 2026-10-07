#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';
import { redactDiagnosticText } from '../../../src/shared/diagnostic-text.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

applyTestEnv();
const root = process.cwd();
const nodeBin = path.dirname(process.execPath);
// Cold Pyright startup measured ~0.7s normally and ~2s with V8 coverage before
// hosted contention. This is availability/usage compatibility, not a speed test.
// Production fast-tier and explicit short-deadline tests remain unchanged.
const probeTimeoutMs = 8000;
await withTemporaryEnv({ PATH: nodeBin, Path: nodeBin }, async () => {
  const started = performance.now();
  const profile = resolveToolingCommandProfile({
    providerId: 'pyright', cmd: 'pyright-langserver', args: ['--stdio'],
    repoRoot: root, toolingConfig: { cache: { enabled: false } }, probeTimeoutMs
  });
  const diagnostics = {
    platform: process.platform, node: process.version,
    elapsedMs: Math.round(performance.now() - started), probeTimeoutMs,
    command: profile.resolved?.cmd, cached: profile.probe?.cached,
    attempts: (profile.probe?.attempted || []).slice(0, 4).map(attempt => ({
      args: attempt.args, exitCode: attempt.exitCode, errorCode: attempt.errorCode,
      stdout: redactDiagnosticText(attempt.stdout || '', 240),
      stderr: redactDiagnosticText(attempt.stderr || '', 240)
    }))
  };
  assert.equal(profile.probe?.ok, true, `Installed Pyright probe failed: ${JSON.stringify(diagnostics)}`);
  assert.equal(profile.probe.cached, false, 'a persistent or in-memory hit must not replace actual startup');
  assert.ok(profile.probe.attempted.length > 0, 'the installed executable must actually run');
  const expected = path.join(root, 'node_modules', '.bin', process.platform === 'win32'
    ? 'pyright-langserver.cmd' : 'pyright-langserver');
  assert.equal(await fs.realpath(profile.resolved.cmd), await fs.realpath(expected));
  console.log(`Installed Pyright cold probe passed in ${diagnostics.elapsedMs}ms.`);
});
