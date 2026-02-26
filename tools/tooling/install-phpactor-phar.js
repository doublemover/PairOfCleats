#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';

const PHPACTOR_PHAR_URL = 'https://github.com/phpactor/phpactor/releases/latest/download/phpactor.phar';

const argv = createCli({
  scriptName: 'install-phpactor-phar',
  options: {
    scope: { type: 'string', default: 'cache' },
    'tooling-root': { type: 'string' },
    'bin-dir': { type: 'string' }
  }
}).parse();

const homeDir = String(process.env.USERPROFILE || process.env.HOME || '').trim();
const localAppData = String(process.env.LOCALAPPDATA || '').trim();
const scope = String(argv.scope || 'cache').trim().toLowerCase();

const resolveBinDir = () => {
  if (typeof argv['bin-dir'] === 'string' && argv['bin-dir'].trim()) return argv['bin-dir'].trim();
  if (scope === 'cache') {
    const toolingRoot = String(argv['tooling-root'] || '').trim();
    if (!toolingRoot) {
      throw new Error('Missing --tooling-root for cache phpactor install.');
    }
    return path.join(toolingRoot, 'bin');
  }
  if (process.platform === 'win32') {
    const base = localAppData || (homeDir ? path.join(homeDir, 'AppData', 'Local') : '');
    if (!base) throw new Error('Cannot resolve LOCALAPPDATA for phpactor user install.');
    return path.join(base, 'Programs', 'phpactor');
  }
  if (!homeDir) throw new Error('Cannot resolve HOME for phpactor user install.');
  return path.join(homeDir, '.local', 'bin');
};

const binDir = resolveBinDir();
await fs.mkdir(binDir, { recursive: true });

const pharPath = path.join(binDir, 'phpactor.phar');
const tempPath = `${pharPath}.tmp-${process.pid}-${Date.now()}`;
const response = await fetch(PHPACTOR_PHAR_URL, { redirect: 'follow' });
if (!response.ok) {
  throw new Error(`Failed to download phpactor PHAR (${response.status} ${response.statusText}).`);
}
const body = Buffer.from(await response.arrayBuffer());
if (!body.length) {
  throw new Error('Downloaded empty phpactor PHAR payload.');
}
await fs.writeFile(tempPath, body);
await fs.rename(tempPath, pharPath);

if (process.platform === 'win32') {
  const cmdPath = path.join(binDir, 'phpactor.cmd');
  await fs.writeFile(cmdPath, '@echo off\r\nphp "%~dp0phpactor.phar" %*\r\n', 'ascii');
} else {
  const shimPath = path.join(binDir, 'phpactor');
  await fs.writeFile(
    shimPath,
    '#!/usr/bin/env sh\nset -eu\nexec php "$(dirname "$0")/phpactor.phar" "$@"\n',
    'utf8'
  );
  await fs.chmod(shimPath, 0o755);
}
