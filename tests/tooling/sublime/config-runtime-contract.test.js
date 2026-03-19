#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const configPath = path.join(root, 'sublime', 'PairOfCleats', 'lib', 'config.py');
const contractPath = path.join(root, 'src', 'shared', 'editor-config-contract.json');

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

console.log('sublime runtime contract source test passed');
