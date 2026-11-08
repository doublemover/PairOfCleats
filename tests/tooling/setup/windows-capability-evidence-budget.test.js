// Source regression authored for the development batch; UNVALIDATED.
// The actual evidence owner reads disposable bytes; compiler/linker children
// are inert injections and no native compiler or produced executable runs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { verifyWindowsCompilerCapability } from '../../../tools/setup/windows-capability.js';

const root = await makeTempDir('windows-capability-evidence-');
const originalOpen = fs.open;
let openInputs = 0, maximumInputs = 0;
try {
  const toolset = path.join(root, 'vs', 'VC', 'Tools', 'MSVC', '14.fixture');
  const compiler = path.join(toolset, 'bin', 'Hostx64', 'x64', 'cl.exe');
  const sdk = { root: path.join(root, 'sdk'), version: '10.0.26100.0' };
  const files = [compiler, path.join(path.dirname(compiler), 'link.exe'), path.join(toolset, 'include', 'vector'),
    path.join(sdk.root, 'Include', sdk.version, 'um', 'Windows.h'), path.join(sdk.root, 'Include', sdk.version, 'ucrt', 'stdio.h'),
    path.join(sdk.root, 'Lib', sdk.version, 'um', 'x64', 'kernel32.lib'), path.join(sdk.root, 'Lib', sdk.version, 'ucrt', 'x64', 'ucrt.lib')];
  for (const file of files) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'inert input evidence'); }
  const report = { platform: 'win32', arch: 'x64', toolchain: { compiler: { executable: compiler }, sdk }, childEnv: {} };
  const spawn = async (_command, args) => {
    const object = args.find(arg => arg.startsWith('/Fo'));
    const image = args.find(arg => arg.startsWith('/OUT:'));
    if (object) { const bytes = Buffer.alloc(20); bytes.writeUInt16LE(0x8664); await fs.writeFile(object.slice(3), bytes); }
    if (image) {
      const bytes = Buffer.alloc(88); bytes.writeUInt16LE(0x5a4d); bytes.writeUInt32LE(64, 0x3c);
      bytes.writeUInt32LE(0x4550, 64); bytes.writeUInt16LE(0x8664, 68); await fs.writeFile(image.slice(5), bytes);
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    openInputs++;
    maximumInputs = Math.max(maximumInputs, openInputs);
    let closed = false;
    return new Proxy(handle, { get(target, key) {
      if (key === 'close') return async () => { await target.close(); if (!closed) { closed = true; openInputs--; } };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home'), PAIROFCLEATS_CACHE_ROOT: '',
    PAIROFCLEATS_TESTING: '1' }, async () => {
    const receipt = await verifyWindowsCompilerCapability(report, { scratchRoot: path.join(root, 'runs'), spawn });
    assert.equal(receipt.state, 'compile-link-target-verified');
    assert.equal(maximumInputs, 1, 'native evidence passes admit one bounded contained file read across all inputs');
    assert.equal(openInputs, 0);
    assert.equal(receipt.files.length, 7);
    assert.equal(receipt.outputs.length, 2);
    assert.ok([...receipt.files, ...receipt.outputs].every(file => !Object.hasOwn(file, 'contents') && /^[a-f0-9]{64}$/u.test(file.sha256)),
      'the retained capability receipt contains only file metadata/hashes, never full input or output buffers');

    let children = 0;
    await assert.rejects(verifyWindowsCompilerCapability(report, { scratchRoot: path.join(root, 'changed-runs'),
      spawn: async (...args) => { children++; const result = await spawn(...args); if (children === 1) await fs.writeFile(files[2], 'changed input evidence'); return result; }
    }), /bytes changed during capability/);
    assert.equal(openInputs, 0, 'failed evidence revalidation closes all admitted file handles');
  });
} finally { fs.open = originalOpen; await rmDirRecursive(root); }
console.log('Windows capability retains bounded sequential evidence reads and metadata-only receipts.');
