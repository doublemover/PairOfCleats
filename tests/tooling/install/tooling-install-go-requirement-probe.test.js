#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const tempRoot = resolveTestCachePath(root, 'tooling-install-go-requirement-probe');
const binDir = path.join(tempRoot, 'bin');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(binDir, { recursive: true });

if (process.platform === 'win32') {
  await fs.writeFile(
    path.join(binDir, 'go.cmd'),
    '@echo off\r\nif "%1"=="version" exit /b 0\r\nif "%1"=="install" exit /b 0\r\nexit /b 1\r\n',
    'utf8'
  );
} else {
  const goPath = path.join(binDir, 'go');
  await fs.writeFile(
    goPath,
    '#!/usr/bin/env sh\nif [ "$1" = "version" ]; then exit 0; fi\nif [ "$1" = "install" ]; then exit 0; fi\nexit 1\n',
    'utf8'
  );
  await fs.chmod(goPath, 0o755);
}

const env = {
  ...process.env,
  PATH: binDir,
  Path: binDir
};

const result = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'tooling', 'install.js'), '--root', fixtureRoot, '--tools', 'gopls', '--dry-run', '--json'],
  { encoding: 'utf8', env }
);

if (result.status !== 0) {
  console.error('tooling-install go requirement probe test failed: command exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(String(result.stdout || '{}'));
} catch {
  console.error('tooling-install go requirement probe test failed: stdout was not valid JSON');
  process.exit(1);
}

const goplsResult = Array.isArray(payload?.results)
  ? payload.results.find((entry) => entry?.id === 'gopls')
  : null;
if (goplsResult?.status === 'missing-requirement') {
  console.error('tooling-install go requirement probe test failed: go requirement should pass with `go version`');
  process.exit(1);
}

const goplsAction = Array.isArray(payload?.actions)
  ? payload.actions.find((entry) => entry?.id === 'gopls')
  : null;
if (!goplsAction) {
  console.error('tooling-install go requirement probe test failed: expected gopls install action');
  process.exit(1);
}

console.log('tooling-install go requirement probe test passed');
