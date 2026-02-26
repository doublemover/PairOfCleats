#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'tooling', 'install.js'),
    '--root', fixtureRoot,
    '--tools', 'phpactor',
    '--dry-run',
    '--json'
  ],
  { encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error('tooling-install phpactor phar plan test failed: install command exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(String(result.stdout || '{}'));
} catch {
  console.error('tooling-install phpactor phar plan test failed: stdout was not valid JSON');
  process.exit(1);
}

const phpactorResult = Array.isArray(payload?.results)
  ? payload.results.find((entry) => entry?.id === 'phpactor')
  : null;
if (phpactorResult?.status === 'already-installed') {
  console.log('tooling install phpactor phar plan test passed (already installed)');
  process.exit(0);
}

const phpactorAction = Array.isArray(payload?.actions)
  ? payload.actions.find((entry) => entry?.id === 'phpactor')
  : null;
if (!phpactorAction) {
  console.error('tooling-install phpactor phar plan test failed: expected phpactor install action');
  process.exit(1);
}
if (phpactorAction.cmd !== process.execPath) {
  console.error('tooling-install phpactor phar plan test failed: expected phpactor plan to execute via node');
  process.exit(1);
}
const args = Array.isArray(phpactorAction.args) ? phpactorAction.args.map((value) => String(value)) : [];
if (!args.some((value) => value.endsWith(path.join('tools', 'tooling', 'install-phpactor-phar.js')))) {
  console.error('tooling-install phpactor phar plan test failed: expected phpactor phar installer script');
  process.exit(1);
}
if (!(args.includes('--scope') && args.includes('cache'))) {
  console.error('tooling-install phpactor phar plan test failed: expected cache scope install args');
  process.exit(1);
}

console.log('tooling install phpactor phar plan test passed');
