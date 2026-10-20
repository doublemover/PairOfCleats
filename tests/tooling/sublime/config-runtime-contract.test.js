#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runNode } from '../../helpers/run-node.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const configPath = path.join(root, 'sublime', 'PairOfCleats', 'lib', 'config.py');
const contractPath = path.join(root, 'src', 'contracts', 'editor-config-contract.json');

for (const target of [configPath, contractPath]) {
  if (!fs.existsSync(target)) {
    console.error(`Sublime runtime contract test missing required file: ${target}`);
    process.exit(1);
  }
}

const configSource = fs.readFileSync(configPath, 'utf8');
if (configSource.includes('docs/tooling/editor-config-contract.json')) {
  console.error('Sublime config must not load editor config contract from docs/tooling.');
  process.exit(1);
}

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const sublimeSettings = contract?.settings?.sublime || {};
for (const key of ['cliPathKey', 'nodePathKey', 'apiServerUrlKey', 'apiTimeoutKey', 'apiExecutionModeKey', 'envKey']) {
  if (typeof sublimeSettings[key] !== 'string' || sublimeSettings[key].trim().length === 0) {
    console.error(`Runtime editor config contract missing sublime settings.${key}.`);
    process.exit(1);
  }
}

const pythonPolicy = runNode(['tools/tooling/python-check.js', '--json'], 'python policy', root, process.env,
  { stdio: 'pipe' });
const python = JSON.parse(pythonPolicy.stdout).python;
const checkInstalledPackage = source => {
  const result = spawnSync(python, ['tests/helpers/sublime/relocated_package.py', source],
    { cwd: root, encoding: 'utf8', timeout: 8000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /relocated plugin registration and packed-resource loading passed/);
};
checkInstalledPackage(path.join(root, 'sublime/PairOfCleats'));
const bundled = JSON.parse(fs.readFileSync(path.join(root, 'sublime/PairOfCleats/editor-config-contract.json'), 'utf8'));
assert.deepEqual(bundled, contract, 'bundled contract must match the authoritative contract');
const out = resolveTestCachePath(root, 'sublime-relocated-runtime');
runNode(['tools/package-sublime.js', '--out-dir', out, '--smoke'], 'package relocated Sublime runtime', root,
  process.env, { stdio: 'pipe' });
checkInstalledPackage(path.join(out, 'pairofcleats.sublime-package'));
console.log('sublime source, copied package and built archive runtime contract tests passed');
