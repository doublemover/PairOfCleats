// Source UNVALIDATED. Explicit invocation compiles/links only run-owned scratch.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { runWithStorageSession } from '../../src/shared/storage/session.js';
import { resolveStorageLayout } from '../../src/shared/storage/layout.js';

const source = '#include <windows.h>\n#include <vector>\n#include <cstdio>\nint main() { std::vector<DWORD> ids{GetCurrentProcessId()}; return std::printf("%lu", static_cast<unsigned long>(ids[0])) < 0; }\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const machine = { x64: 0x8664, arm64: 0xaa64 };

export const inspectWindowsTargetBytes = (bytes, arch, { executable = false } = {}) => {
  const expected = machine[arch];
  if (!expected || !Buffer.isBuffer(bytes) || bytes.length < 20) throw new Error('Missing supported target output.');
  let offset = 0;
  if (executable) {
    if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) throw new Error('Compiler capability output is not a PE image.');
    const header = bytes.readUInt32LE(0x3c);
    if (header < 64 || header > bytes.length - 24 || bytes.readUInt32LE(header) !== 0x4550) throw new Error('Invalid PE target header.');
    offset = header + 4;
  }
  const actual = bytes.readUInt16LE(offset);
  if (actual !== expected) throw new Error(`Compiler target machine disagrees: expected ${arch}, observed 0x${actual.toString(16)}.`);
  return { format: executable ? 'PE' : 'COFF', arch, machine: actual };
};

const readEvidence = async file => {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 128 * 1024 * 1024) throw new Error('Capability evidence must be a bounded regular file.');
  const contents = await fs.readFile(file);
  const after = await fs.stat(file);
  if (contents.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('Capability evidence changed while reading.');
  return { path: file, bytes: before.size, sha256: hash(contents), contents };
};

/** Discovery is required first; no fallback compiler, headers, SDK or target. */
const verifyWindowsCompilerCapabilityOwned = async (report, { scratchRoot, signal = null,
  env = process.env, spawn = spawnResolvedSubprocess } = {}) => {
  if (report?.platform !== 'win32' || !machine[report.arch] || !path.isAbsolute(scratchRoot || '')) throw new Error('Windows capability needs exact discovery and an absolute run-owned scratch parent.');
  signal?.throwIfAborted();
  assertNoSymlinkPath(path.parse(scratchRoot).root, scratchRoot, { allowMissing: true });
  await fs.mkdir(scratchRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(scratchRoot, 'capability-'));
  const compiler = report.toolchain.compiler.executable;
  const compilerBin = path.dirname(compiler);
  const toolset = path.dirname(path.dirname(path.dirname(compilerBin)));
  const linker = path.join(compilerBin, 'link.exe');
  const sdk = report.toolchain.sdk;
  const include = [path.join(toolset, 'include'), ...['ucrt', 'shared', 'um', 'winrt'].map(part => path.join(sdk.root, 'Include', sdk.version, part))];
  const libraries = [path.join(toolset, 'lib', report.arch), ...['um', 'ucrt'].map(part => path.join(sdk.root, 'Lib', sdk.version, part, report.arch))];
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !['cl', '_cl_', 'link', 'include', 'lib', 'libpath', 'path'].includes(key.toLowerCase())));
  Object.assign(childEnv, { ...report.childEnv, INCLUDE: include.join(';'), LIB: libraries.join(';'),
    PATH: [compilerBin, env.PATH || env.Path || ''].join(';'), TEMP: directory, TMP: directory });
  const input = path.join(directory, 'capability.cpp');
  const object = path.join(directory, 'capability.obj');
  const image = path.join(directory, 'capability.exe');
  const sourceBytes = Buffer.from(source);
  const evidenceFiles = [compiler, linker, path.join(toolset, 'include', 'vector'),
    path.join(sdk.root, 'Include', sdk.version, 'um', 'Windows.h'), path.join(sdk.root, 'Include', sdk.version, 'ucrt', 'stdio.h'),
    path.join(sdk.root, 'Lib', sdk.version, 'um', report.arch, 'kernel32.lib'), path.join(sdk.root, 'Lib', sdk.version, 'ucrt', report.arch, 'ucrt.lib')];
  const before = await Promise.all(evidenceFiles.map(readEvidence));
  const stages = [];
  try {
    await fs.writeFile(input, sourceBytes, { flag: 'wx' });
    for (const [name, command, args] of [
      ['compile', compiler, ['/nologo', '/Bv', '/c', '/EHsc', '/std:c++20', '/MD', '/Fo' + object, input]],
      ['link', linker, ['/NOLOGO', '/MACHINE:' + report.arch.toUpperCase(), '/OUT:' + image, object, 'kernel32.lib']]
    ]) {
      signal?.throwIfAborted();
      const result = await spawn(command, args, { cwd: directory, env: childEnv, signal, timeoutMs: 30000,
        outputEncoding: 'utf8', maxOutputBytes: 65536, rejectOnNonZeroExit: false });
      stages.push({ stage: name, command, args, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
      if (result.exitCode !== 0 || result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated) throw new Error(`Selected Windows ${name} capability failed; see stage evidence.`);
    }
    const objectEvidence = await readEvidence(object), imageEvidence = await readEvidence(image);
    const targets = [inspectWindowsTargetBytes(objectEvidence.contents, report.arch), inspectWindowsTargetBytes(imageEvidence.contents, report.arch, { executable: true })];
    const after = await Promise.all(evidenceFiles.map(readEvidence));
    if (before.some((file, index) => file.sha256 !== after[index].sha256)) throw new Error('Selected compiler/header/library bytes changed during capability verification.');
    const strip = ({ contents, ...file }) => file;
    const receipt = { schemaVersion: 1, kind: 'windows-compiler-capability', state: 'compile-link-target-verified',
      platform: report.platform, arch: report.arch, directory, source: { bytes: sourceBytes.length, sha256: hash(sourceBytes) },
      selected: { compiler, linker, toolset, sdk, include, libraries }, files: before.map(strip),
      outputs: [strip(objectEvidence), strip(imageEvidence)], targets, stages,
      qualification: 'Selected compiler, C++/Windows/UCRT headers, link libraries and output target only; executable not run; native package activation still required.' };
    await fs.writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
    return receipt;
  } catch (error) {
    error.windowsCapability = { directory, stages, state: error.cacheOwnershipPending === true ? 'teardown-pending' : 'failed', outputsRetained: true };
    throw error;
  }
};

export const verifyWindowsCompilerCapability = async (report, options = {}) => {
  if (!path.isAbsolute(options.scratchRoot || '')) throw new Error('Windows capability requires an absolute run-owned scratch parent.');
  const layout = resolveStorageLayout();
  const state = layout.descriptors.state.path;
  let session;
  try { session = await runWithStorageSession({ roots: [options.scratchRoot], coordinationRoot: path.join(state, 'storage-access'),
    authorizedRoots: [options.scratchRoot, state], scope: 'windows-compiler-capability' },
  () => verifyWindowsCompilerCapabilityOwned(report, options), { settlement: ({ error, resourceId }) => {
    const settled = !error?.cacheOwnershipPending || error.cacheOwnershipReleased?.() === true;
    return { resourceId, settled, pending: !settled };
  } }); } catch (error) {
    if (error.cacheOwnershipPending && error.storageSession) {
      const held = error.storageSession;
      Object.defineProperty(error, 'windowsCapabilitySession', { configurable: true, value: {
        resourceId: held.resourceId, releaseAfterClosure: () => {
          if (error.cacheOwnershipReleased?.() !== true) throw new Error('Actual Windows capability child/tree closure remains pending.');
          return held.releaseAfterSettlement({ resourceId: held.resourceId, settled: true, pending: false });
        }
      } });
    }
    throw error;
  }
  return session.value;
};
