#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const tempRoot = resolveTestCachePath(root, 'tooling-install-dotnet-requirement-probe');
const binDir = path.join(tempRoot, 'bin');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(binDir, { recursive: true });

if (process.platform === 'win32') {
  await fs.writeFile(
    path.join(binDir, 'dotnet.cmd'),
    '@echo off\r\nif \"%1\"==\"--info\" exit /b 0\r\nif \"%1\"==\"--version\" exit /b 1\r\nif \"%1\"==\"tool\" exit /b 0\r\nexit /b 1\r\n',
    'utf8'
  );
} else {
  const dotnetPath = path.join(binDir, 'dotnet');
  await fs.writeFile(
    dotnetPath,
    '#!/bin/sh\nif [ \"$1\" = \"--info\" ]; then exit 0; fi\nif [ \"$1\" = \"--version\" ]; then exit 1; fi\nif [ \"$1\" = \"tool\" ]; then exit 0; fi\nexit 1\n',
    'utf8'
  );
  await fs.chmod(dotnetPath, 0o755);
}

const env = {
  ...process.env,
  PATH: binDir,
  Path: binDir
};

const result = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'tooling', 'install.js'), '--root', fixtureRoot, '--tools', 'csharp-ls', '--dry-run', '--json'],
  { encoding: 'utf8', env }
);

if (result.status !== 0) {
  console.error('tooling-install dotnet requirement probe test failed: command exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(String(result.stdout || '{}'));
} catch {
  console.error('tooling-install dotnet requirement probe test failed: stdout was not valid JSON');
  process.exit(1);
}

const csharpResult = Array.isArray(payload?.results)
  ? payload.results.find((entry) => entry?.id === 'csharp-ls')
  : null;
if (csharpResult?.status === 'missing-requirement') {
  console.error('tooling-install dotnet requirement probe test failed: dotnet requirement should pass with `dotnet --info`');
  process.exit(1);
}
if (csharpResult?.status === 'already-installed') {
  console.log('tooling-install dotnet requirement probe test passed (already installed)');
  process.exit(0);
}

const csharpAction = Array.isArray(payload?.actions)
  ? payload.actions.find((entry) => entry?.id === 'csharp-ls')
  : null;
if (!csharpAction) {
  console.error('tooling-install dotnet requirement probe test failed: expected csharp-ls install action');
  process.exit(1);
}

console.log('tooling-install dotnet requirement probe test passed');
