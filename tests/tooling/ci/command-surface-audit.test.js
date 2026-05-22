#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPackageScriptReplacement, listPackageScriptReplacements } from '../../../src/shared/command-aliases.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const scriptPath = path.join(ROOT, 'tools', 'ci', 'check-command-surface.js');
const env = applyTestEnv({ syncProcess: false });

assert.equal(getPackageScriptReplacement('build-index'), null, 'legacy product aliases should not remain in the contributor npm surface');
assert.equal(getPackageScriptReplacement('verify'), null, 'verify should remain a contributor workflow, not a deprecated CLI alias');
assert.equal(listPackageScriptReplacements().length, 0, 'expected no deprecated package-script replacements after npm surface reduction');

const result = runNode([scriptPath], 'command surface audit', ROOT, env, { stdio: 'pipe' });
assert.equal(result.status, 0, result.stderr || result.stdout || 'command surface audit failed');
assert.match(result.stdout, /command surface audit passed/, 'expected success summary from command surface audit');

console.log('command surface audit test passed');
