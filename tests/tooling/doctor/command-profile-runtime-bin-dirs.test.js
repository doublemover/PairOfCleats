#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const toolingDir = resolveTestCachePath(root, 'command-profile-runtime-bin-dirs');
const dotnetDir = path.join(toolingDir, 'dotnet');
const composerBinDir = path.join(toolingDir, 'composer', 'vendor', 'bin');
const makeExecutable = async (targetPath, body) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, body, 'utf8');
  if (process.platform !== 'win32') {
    await fs.chmod(targetPath, 0o755);
  }
};

const csharpScript = process.platform === 'win32'
  ? '@echo off\r\nnode "%~dp0\\ok.js" %*\r\n'
  : '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nif [ "$1" = "--help" ]; then exit 0; fi\nexit 0\n';
const phpactorScript = process.platform === 'win32'
  ? '@echo off\r\nnode "%~dp0\\ok.js" %*\r\n'
  : '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nif [ "$1" = "--help" ]; then exit 0; fi\nif [ "$1" = "language-server" ]; then exit 0; fi\nexit 0\n';

await withTemporaryEnv({
  PATH: path.dirname(process.execPath),
  Path: path.dirname(process.execPath),
  PAIROFCLEATS_TESTING: '1'
}, async () => {
  await fs.rm(toolingDir, { recursive: true, force: true });
  try {
    const csharpPath = path.join(dotnetDir, process.platform === 'win32' ? 'csharp-ls.cmd' : 'csharp-ls');
    const phpactorPath = path.join(composerBinDir, process.platform === 'win32' ? 'phpactor.cmd' : 'phpactor');
    await makeExecutable(csharpPath, csharpScript);
    await makeExecutable(phpactorPath, phpactorScript);
    if (process.platform === 'win32') {
      await fs.writeFile(
        path.join(dotnetDir, 'ok.js'),
        '#!/usr/bin/env node\nprocess.exit(0);\n',
        'utf8'
      );
      await fs.writeFile(
        path.join(composerBinDir, 'ok.js'),
        '#!/usr/bin/env node\nprocess.exit(0);\n',
        'utf8'
      );
    }

    const csharpProfile = resolveToolingCommandProfile({
      providerId: 'csharp-ls',
      cmd: 'csharp-ls',
      args: [],
      repoRoot: root,
      toolingConfig: { dir: toolingDir }
    });
    assert.equal(csharpProfile.probe.ok, true, 'expected csharp-ls probe to succeed from tooling dotnet dir');
    assert.equal(path.dirname(csharpProfile.resolved.cmd), dotnetDir, 'expected csharp-ls resolved from tooling dotnet dir');

    const phpactorProfile = resolveToolingCommandProfile({
      providerId: 'phpactor',
      cmd: 'phpactor',
      args: ['language-server'],
      repoRoot: root,
      toolingConfig: { dir: toolingDir }
    });
    assert.equal(phpactorProfile.probe.ok, true, 'expected phpactor probe to succeed from tooling composer bin');
    assert.equal(path.dirname(phpactorProfile.resolved.cmd), composerBinDir, 'expected phpactor resolved from tooling composer bin');

    console.log('tooling doctor command profile runtime bin dirs test passed');
  } finally {
    await fs.rm(toolingDir, { recursive: true, force: true });
  }
});
