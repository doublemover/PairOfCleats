#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { validateLuaLanguageServerPackageLayout } from '../../../tools/tooling/install-lua-language-server.js';
import { runNode } from '../../helpers/run-node.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lua-language-server-install-${process.pid}-${Date.now()}`);
const env = applyTestEnv({ syncProcess: false });
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const executableName = process.platform === 'win32' ? 'lua-language-server.exe' : 'lua-language-server';

const createArchive = async ({ archivePath, includeMainLua }) => {
  const zip = new AdmZip();
  zip.addFile(`bin/${executableName}`, Buffer.from('stub executable\n', 'utf8'));
  if (includeMainLua) {
    zip.addFile('bin/main.lua', Buffer.from('print("main")\n', 'utf8'));
  }
  zip.addFile('main.lua', Buffer.from('print("root main")\n', 'utf8'));
  zip.addFile('script/init.lua', Buffer.from('return {}\n', 'utf8'));
  zip.addFile('locale/en-us/script.lua', Buffer.from('return {}\n', 'utf8'));
  await fs.writeFile(archivePath, zip.toBuffer());
};

const runInstaller = ({ toolingRoot, archivePath, allowFailure = false }) => runNode(
  [
    path.join(root, 'tools', 'tooling', 'install-lua-language-server.js'),
    '--scope',
    'cache',
    '--tooling-root',
    toolingRoot,
    '--url',
    archivePath
  ],
  'install lua language server',
  root,
  env,
  {
    stdio: 'pipe',
    allowFailure
  }
);

try {
  const goodArchivePath = path.join(tempRoot, 'lua-language-server-good.zip');
  const goodToolingRoot = path.join(tempRoot, 'tooling-good');
  await createArchive({ archivePath: goodArchivePath, includeMainLua: true });
  const goodResult = runInstaller({ toolingRoot: goodToolingRoot, archivePath: goodArchivePath });
  assert.equal(goodResult.status, 0, goodResult.stderr || goodResult.stdout);
  const goodLayout = validateLuaLanguageServerPackageLayout(goodToolingRoot);
  assert.equal(await fs.stat(goodLayout.executablePath).then(() => true).catch(() => false), true);
  assert.equal(await fs.stat(goodLayout.mainLuaPath).then(() => true).catch(() => false), true);

  const brokenArchivePath = path.join(tempRoot, 'lua-language-server-broken.zip');
  const brokenToolingRoot = path.join(tempRoot, 'tooling-broken');
  await createArchive({ archivePath: brokenArchivePath, includeMainLua: false });
  const brokenResult = runInstaller({
    toolingRoot: brokenToolingRoot,
    archivePath: brokenArchivePath,
    allowFailure: true
  });
  assert.notEqual(brokenResult.status, 0, 'expected installer to reject archive missing bin/main.lua');
  assert.match(String(brokenResult.stderr || brokenResult.stdout || ''), /expected bin\/main\.lua package layout/u);

  console.log('lua-language-server install test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
