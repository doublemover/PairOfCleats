#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getPackageScriptReplacement, listPackageScriptReplacements } from '../../../src/shared/command-aliases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const scriptPath = path.join(ROOT, 'tools', 'ci', 'check-command-surface.js');

assert.equal(getPackageScriptReplacement('build-index'), null, 'legacy product aliases should not remain in the contributor npm surface');
assert.equal(getPackageScriptReplacement('verify'), null, 'verify should remain a contributor workflow, not a deprecated CLI alias');
assert.equal(listPackageScriptReplacements().length, 0, 'expected no deprecated package-script replacements after npm surface reduction');

const result = spawnSync(process.execPath, [scriptPath], {
  cwd: ROOT,
  encoding: 'utf8'
});
assert.equal(result.status, 0, result.stderr || result.stdout || 'command surface audit failed');
assert.match(result.stdout, /command surface audit passed/, 'expected success summary from command surface audit');

console.log('command surface audit test passed');
