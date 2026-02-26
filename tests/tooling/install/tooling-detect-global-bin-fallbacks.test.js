#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const tempRoot = resolveTestCachePath(root, 'tooling-detect-global-bin-fallbacks');
const homeDir = path.join(tempRoot, 'home');
const appDataDir = path.join(tempRoot, 'appdata');
const localAppDataDir = path.join(tempRoot, 'localappdata');
const dotnetGlobalBin = path.join(homeDir, '.dotnet', 'tools');
const phpactorGlobalBin = path.join(localAppDataDir, 'Programs', 'phpactor');
const gemGlobalBin = path.join(homeDir, '.local', 'share', 'gem', 'ruby', '3.4.0', 'bin');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(dotnetGlobalBin, { recursive: true });
await fs.mkdir(phpactorGlobalBin, { recursive: true });
await fs.mkdir(gemGlobalBin, { recursive: true });
await fs.mkdir(path.join(localAppDataDir, 'Microsoft', 'WindowsApps'), { recursive: true });

if (process.platform === 'win32') {
  await fs.writeFile(
    path.join(dotnetGlobalBin, 'csharp-ls.cmd'),
    '@echo off\r\nif "%1"=="--version" exit /b 1\r\nif "%1"=="--help" exit /b 0\r\nexit /b 0\r\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(phpactorGlobalBin, 'phpactor.cmd'),
    '@echo off\r\nif "%1"=="--version" exit /b 0\r\nif "%1"=="--help" exit /b 0\r\nexit /b 0\r\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(gemGlobalBin, 'solargraph.cmd'),
    '@echo off\r\nif "%1"=="--version" exit /b 0\r\nif "%1"=="--help" exit /b 0\r\nexit /b 0\r\n',
    'utf8'
  );
} else {
  const csharpPath = path.join(dotnetGlobalBin, 'csharp-ls');
  const phpactorPath = path.join(phpactorGlobalBin, 'phpactor');
  const solargraphPath = path.join(gemGlobalBin, 'solargraph');
  await fs.writeFile(
    csharpPath,
    '#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then exit 1; fi\nif [ "$1" = "--help" ]; then exit 0; fi\nexit 0\n',
    'utf8'
  );
  await fs.writeFile(
    phpactorPath,
    '#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then exit 0; fi\nif [ "$1" = "--help" ]; then exit 0; fi\nexit 0\n',
    'utf8'
  );
  await fs.writeFile(
    solargraphPath,
    '#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then exit 0; fi\nif [ "$1" = "--help" ]; then exit 0; fi\nexit 0\n',
    'utf8'
  );
  await fs.chmod(csharpPath, 0o755);
  await fs.chmod(phpactorPath, 0o755);
  await fs.chmod(solargraphPath, 0o755);
}

const baselinePath = path.dirname(process.execPath);
const env = {
  ...process.env,
  HOME: homeDir,
  USERPROFILE: homeDir,
  APPDATA: appDataDir,
  LOCALAPPDATA: localAppDataDir,
  PATH: baselinePath,
  Path: baselinePath
};

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'tooling', 'detect.js'),
    '--root', fixtureRoot,
    '--languages', 'csharp,ruby,php',
    '--json'
  ],
  { encoding: 'utf8', env }
);

if (result.status !== 0) {
  console.error('tooling-detect global bin fallback test failed: detect command exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(String(result.stdout || '{}'));
} catch {
  console.error('tooling-detect global bin fallback test failed: stdout was not valid JSON');
  process.exit(1);
}

const tools = Array.isArray(payload?.tools) ? payload.tools : [];
const byId = new Map(tools.map((entry) => [entry?.id, entry]));

const requiredToolIds = ['csharp-ls', 'solargraph', 'phpactor'];
for (const toolId of requiredToolIds) {
  const entry = byId.get(toolId);
  if (!entry || entry.found !== true) {
    console.error(`tooling-detect global bin fallback test failed: expected ${toolId} to be detected`);
    process.exit(1);
  }
}

console.log('tooling detect global bin fallback test passed');
