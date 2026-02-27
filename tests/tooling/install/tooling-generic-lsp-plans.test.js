#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const result = spawnSync(process.execPath, [
  path.join(root, 'tools', 'tooling', 'install.js'),
  '--root', fixtureRoot,
  '--tools', 'yaml-language-server,zls',
  '--dry-run',
  '--json'
], { encoding: 'utf8' });

if (result.status !== 0) {
  console.error('tooling-install generic lsp plans test failed: install command failed');
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  console.error('tooling-install generic lsp plans test failed: stdout was not valid JSON');
  process.exit(1);
}

const actions = Array.isArray(payload.actions) ? payload.actions : [];
const results = Array.isArray(payload.results) ? payload.results : [];

const yamlAction = actions.find((entry) => entry?.id === 'yaml-language-server');
const yamlResult = results.find((entry) => entry?.id === 'yaml-language-server');
if (!yamlAction && !yamlResult) {
  console.error('tooling-install generic lsp plans test failed: expected yaml-language-server action or result');
  process.exit(1);
}
if (yamlAction && yamlAction.cmd !== 'npm') {
  console.error('tooling-install generic lsp plans test failed: expected yaml-language-server to use npm plan');
  process.exit(1);
}
if (yamlResult && yamlResult.status === 'manual') {
  console.error('tooling-install generic lsp plans test failed: yaml-language-server should not be manual');
  process.exit(1);
}

const zlsAction = actions.find((entry) => entry?.id === 'zls');
if (zlsAction) {
  console.error('tooling-install generic lsp plans test failed: zls should not have an auto-install action');
  process.exit(1);
}
const zlsResult = results.find((entry) => entry?.id === 'zls');
if (!zlsResult || !['manual', 'already-installed'].includes(zlsResult.status)) {
  console.error('tooling-install generic lsp plans test failed: expected zls manual/already-installed result');
  process.exit(1);
}

console.log('tooling install generic lsp plans test passed');
