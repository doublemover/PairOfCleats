import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { detectTool } from '../../../tools/tooling/utils.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
const { dir } = await prepareIsolatedTestCacheDir('tool-detect-probe-diagnostics');
const script = path.join(dir, 'explicit diagnostic fixture.cjs');
const secret = 'fixture-private-password';
const message = `provider prerequisite unavailable; password=${secret}; Bearer fixture-private-token\n${'x'.repeat(2000)}`;
await fs.writeFile(script, `#!/usr/bin/env node\nprocess.stderr.write(${JSON.stringify(message)});process.exit(23);\n`, { mode: 0o755 });
let command = script;
if (process.platform === 'win32') {
  command = path.join(dir, 'explicit diagnostic fixture.cmd');
  await fs.writeFile(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
}
// This explicitly selected fixture command cannot launch a real provider or
// install anything. Installed-tool and repository command authority stay separate.
const result = detectTool({ id: 'explicit-diagnostic-fixture', detect: { cmd: command, args: ['--version'] } });
assert.equal(result.found, false);
assert.equal(result.probe.outcome, 'nonzero');
assert.ok(result.probe.attempts.length >= 3, 'all retained argument candidates must report their actual failure');
for (const attempt of result.probe.attempts) {
  assert.equal(attempt.status, 23); assert.equal(attempt.outcome, 'nonzero');
  assert.ok(attempt.stderrExcerpt?.includes('provider prerequisite unavailable'), 'failed probes retain a useful diagnostic');
  assert.ok(attempt.stderrExcerpt.length <= 768, 'report excerpts remain bounded');
  assert.ok(attempt.stderrExcerpt.includes('[redacted]'));
}
const serialized = JSON.stringify(result);
assert.equal(serialized.includes(secret), false); assert.equal(serialized.includes('fixture-private-token'), false);
console.log('Tool detection retains bounded redacted diagnostics for every failed argument candidate');
