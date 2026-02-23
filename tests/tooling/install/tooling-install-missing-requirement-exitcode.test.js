#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const scriptPath = path.join(root, 'tools', 'tooling', 'install.js');

const env = {
  ...process.env,
  PATH: '',
  Path: ''
};

const result = spawnSync(
  process.execPath,
  [scriptPath, '--root', fixtureRoot, '--tools', 'gopls', '--json'],
  { encoding: 'utf8', env }
);

if (result.status === 0) {
  console.error('tooling-install missing requirement test failed: expected non-zero status');
  process.exit(1);
}

let payload = null;
try {
  payload = JSON.parse(String(result.stdout || '{}'));
} catch {
  console.error('tooling-install missing requirement test failed: stdout was not valid JSON');
  process.exit(1);
}

const gopls = Array.isArray(payload?.results)
  ? payload.results.find((entry) => entry?.id === 'gopls')
  : null;
if (!gopls || gopls.status !== 'missing-requirement') {
  console.error('tooling-install missing requirement test failed: expected gopls missing-requirement result');
  process.exit(1);
}

console.log('tooling-install missing requirement exit code test passed');
