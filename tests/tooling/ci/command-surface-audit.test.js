#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getPackageScriptReplacement, listPackageScriptReplacements } from '../../../src/shared/command-aliases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const scriptPath = path.join(ROOT, 'tools', 'ci', 'check-command-surface.js');

const expectedReplacements = new Map([
  ['build-index', 'pairofcleats index build'],
  ['watch-index', 'pairofcleats index watch'],
  ['search', 'pairofcleats search'],
  ['api-server', 'pairofcleats service api'],
  ['ctags-ingest', 'pairofcleats ingest ctags'],
  ['show-throughput', 'pairofcleats report throughput'],
  ['tui:build', 'pairofcleats tui build --smoke']
]);

for (const [name, replacement] of expectedReplacements) {
  assert.equal(
    getPackageScriptReplacement(name),
    replacement,
    `expected canonical replacement for ${name}`
  );
}
assert.equal(getPackageScriptReplacement('verify'), null, 'verify should remain a contributor workflow, not a deprecated CLI alias');
assert.ok(
  listPackageScriptReplacements().some((entry) => entry.name === 'indexer-service' && entry.replacement === 'pairofcleats service indexer'),
  'expected indexer-service replacement mapping'
);

const result = spawnSync(process.execPath, [scriptPath], {
  cwd: ROOT,
  encoding: 'utf8'
});
assert.equal(result.status, 0, result.stderr || result.stdout || 'command surface audit failed');
assert.match(result.stdout, /command surface audit passed/, 'expected success summary from command surface audit');

console.log('command surface audit test passed');
