#!/usr/bin/env node
// Source UNVALIDATED; compiler/linker are fake argv owners, no native build runs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyWindowsCompilerCapability, inspectWindowsTargetBytes } from '../../../tools/setup/windows-capability.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const parent = path.join(process.cwd(), '.tmp', 'tasks', 'windows-compiler-capability');
await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'case-'));
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home') }, async () => {
    const toolset = path.join(root, 'MSVC', '14.fixture');
    const bin = path.join(toolset, 'bin', 'Hostx64', 'x64');
    const sdk = { root: path.join(root, 'Windows Kits'), version: '10.0.26100.0' };
    for (const file of [path.join(bin, 'cl.exe'), path.join(bin, 'link.exe'), path.join(toolset, 'include', 'vector'),
      path.join(sdk.root, 'Include', sdk.version, 'um', 'Windows.h'), path.join(sdk.root, 'Include', sdk.version, 'ucrt', 'stdio.h'),
      path.join(sdk.root, 'Lib', sdk.version, 'um', 'x64', 'kernel32.lib'), path.join(sdk.root, 'Lib', sdk.version, 'ucrt', 'x64', 'ucrt.lib')]) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'inert fixture evidence');
    }
    const report = { platform: 'win32', arch: 'x64', childEnv: { npm_config_python: 'fixture' },
      toolchain: { compiler: { executable: path.join(bin, 'cl.exe') }, sdk } };
    const calls = [];
    const spawn = async (command, args, options) => {
      calls.push({ command, args, options });
      assert.equal(options.timeoutMs, 30000);
      assert.equal(options.env.CL, undefined, 'ambient injected compiler options cannot change selected probe');
      assert.equal(options.env.LINK, undefined);
      assert.ok(options.env.INCLUDE.startsWith(path.join(toolset, 'include')));
      if (command.endsWith('cl.exe')) {
        const bytes = Buffer.alloc(20); bytes.writeUInt16LE(0x8664, 0);
        await fs.writeFile(args.find(arg => arg.startsWith('/Fo')).slice(3), bytes);
      } else {
        const bytes = Buffer.alloc(256); bytes.writeUInt16LE(0x5a4d, 0); bytes.writeUInt32LE(128, 0x3c);
        bytes.writeUInt32LE(0x4550, 128); bytes.writeUInt16LE(0x8664, 132);
        await fs.writeFile(args.find(arg => arg.startsWith('/OUT:')).slice(5), bytes);
      }
      return { exitCode: 0, stdout: 'fixture selected compiler version', stderr: '' };
    };
    const receipt = await verifyWindowsCompilerCapability(report, { scratchRoot: path.join(root, 'scratch'), spawn, env: { CL: '/wrong-target', LINK: '/wrong-link', PATH: 'fixture' } });
    assert.equal(receipt.state, 'compile-link-target-verified');
    assert.equal(calls.length, 2);
    assert.equal(receipt.targets[0].arch, 'x64');
    assert.ok(receipt.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
    assert.match(await fs.readFile(path.join(receipt.directory, 'receipt.json'), 'utf8'), /executable not run/);
    const wrongTarget = Buffer.alloc(20); wrongTarget.writeUInt16LE(0xaa64, 0);
    assert.throws(() => inspectWindowsTargetBytes(wrongTarget, 'x64'), /target machine disagrees/);
    let failedStages = 0;
    await assert.rejects(verifyWindowsCompilerCapability(report, { scratchRoot: path.join(root, 'failed'),
      spawn: async () => { failedStages++; return { exitCode: 2, stderr: 'fixture missing SDK header' }; } }), /compile capability failed/);
    assert.equal(failedStages, 1, 'failed compilation cannot be reported as link capability');
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Windows compiler/header/link/target source fixture completed.');
