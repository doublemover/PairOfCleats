#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { installLuaLanguageServer, validateLuaLanguageServerPackageLayout } from '../../../tools/tooling/install-lua-language-server.js';
import { resolveManagedLuaLanguageServer } from '../../../src/shared/managed-lua.js';
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
  assert.equal(validateLuaLanguageServerPackageLayout(path.join(tempRoot, 'not-installed')).ok, false,
    'constructing expected filenames cannot qualify missing runtime bytes');
  await createArchive({ archivePath: goodArchivePath, includeMainLua: true });
  const goodResult = runInstaller({ toolingRoot: goodToolingRoot, archivePath: goodArchivePath });
  assert.equal(goodResult.status, 0, goodResult.stderr || goodResult.stdout);
  const goodLayout = validateLuaLanguageServerPackageLayout(resolveManagedLuaLanguageServer(goodToolingRoot).root);
  assert.equal(await fs.stat(goodLayout.executablePath).then(() => true).catch(() => false), true);
  assert.equal(await fs.stat(goodLayout.mainLuaPath).then(() => true).catch(() => false), true);
  const prior = resolveManagedLuaLanguageServer(goodToolingRoot);
  const installArgs = { scope: 'cache', 'tooling-root': goodToolingRoot, url: goodArchivePath, retries: 0 };
  const pointer = path.join(goodToolingRoot, 'servers', 'lua-language-server', 'current.json');
  const selectedReceipt = await fs.readFile(pointer);
  const unknownReceipt = Buffer.from(JSON.stringify({ ...JSON.parse(selectedReceipt), pinned: 'future retention owner' }));
  await fs.writeFile(pointer, unknownReceipt);
  assert.equal(resolveManagedLuaLanguageServer(goodToolingRoot), null);
  let unknownCopies = 0;
  await assert.rejects(installLuaLanguageServer(installArgs, { copy: async () => { unknownCopies++; } }),
    error => error.reason === 'invalid_existing_selection');
  assert.equal(unknownCopies, 0);
  assert.deepEqual(await fs.readFile(pointer), unknownReceipt, 'a requested update cannot normalize away unknown retained metadata');
  await fs.writeFile(pointer, selectedReceipt);
  await assert.rejects(installLuaLanguageServer(installArgs, { beforeSelection: async () => { await fs.writeFile(pointer, unknownReceipt); } }),
    error => error.reason === 'lua_selection_changed' && error.recovery?.priorGenerationRetained === true);
  assert.deepEqual(await fs.readFile(pointer), unknownReceipt, 'publication rechecks current receipt bytes after replacement preparation');
  assert.equal(await fs.readFile(prior.mainLuaPath, 'utf8'), 'print("main")\n');
  await fs.writeFile(pointer, selectedReceipt);
  for (const hooks of [
    { copy: async () => { throw Object.assign(new Error('copy locked'), { code: 'EPERM' }); } },
    { afterValidation: async () => { throw new Error('post-copy rejected'); } },
    { beforeSelection: async () => { throw new Error('selection locked'); } }
  ]) {
    await assert.rejects(installLuaLanguageServer(installArgs, hooks));
    assert.equal(resolveManagedLuaLanguageServer(goodToolingRoot).root, prior.root);
    assert.equal(await fs.readFile(prior.mainLuaPath, 'utf8'), 'print("main")\n');
  }
  const replaced = await installLuaLanguageServer(installArgs);
  assert.notEqual(replaced.executablePath, prior.command);
  assert.equal(await fs.readFile(prior.mainLuaPath, 'utf8'), 'print("main")\n', 'active old generation remains complete');

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
