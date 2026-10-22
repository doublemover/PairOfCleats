// Source UNVALIDATED. Explicit invocation compiles/links only run-owned scratch.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { runWithStorageSession, isStorageSessionReleaseFailure } from '../../src/shared/storage/session.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { resolveStorageLayout } from '../../src/shared/storage/layout.js';

const source = '#include <windows.h>\n#include <vector>\n#include <cstdio>\nint main() { std::vector<DWORD> ids{GetCurrentProcessId()}; return std::printf("%lu", static_cast<unsigned long>(ids[0])) < 0; }\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const machine = { x64: 0x8664, arm64: 0xaa64 };
const capabilitySessions = new WeakSet();
export const isWindowsCapabilitySession = session => Boolean(session) && capabilitySessions.has(session);
const asError = value => value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
/** Capture original native observation before adding any outer recovery owner. */
export const captureWindowsResourceObservation = error => {
  try {
    const observe = error?.cacheOwnershipReleased;
    if (error?.cacheOwnershipPending !== true && typeof observe !== 'function') return null;
    return () => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};

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

const readEvidence = async (file, { signal = null, includeContents = false } = {}) => {
  const read = await readVerifiedContainedFile(path.parse(file).root, file, { maxBytes: 128 * 1024 * 1024, signal });
  return { path: file, bytes: read.buffer.length, sha256: read.hash, ...(includeContents ? { contents: read.buffer } : {}) };
};

const readInputEvidence = async (files, signal) => {
  const rows = [];
  // Each native input can be large. Retain only its hash/metadata and admit
  // one bounded contained read at a time, across both before/after passes.
  for (const file of files) rows.push(await readEvidence(file, { signal }));
  return rows;
};

const readTargetEvidence = async (file, arch, { signal, executable = false }) => {
  const { contents, ...evidence } = await readEvidence(file, { signal, includeContents: true });
  return { evidence, target: inspectWindowsTargetBytes(contents, arch, { executable }) };
};

/** Discovery is required first; no fallback compiler, headers, SDK or target. */
const verifyWindowsCompilerCapabilityOwned = async (report, { scratchRoot, signal = null,
  env = process.env, spawn = spawnResolvedSubprocess } = {}) => {
  if (report?.platform !== 'win32' || !machine[report.arch] || !path.isAbsolute(scratchRoot || '')) throw new Error('Windows capability needs exact discovery and an absolute run-owned scratch parent.');
  if (!path.isAbsolute(report.toolchain?.compiler?.executable || '') || !path.isAbsolute(report.toolchain?.sdk?.root || '')
    || !/^10\.0\.\d+\.\d+$/u.test(report.toolchain?.sdk?.version || '')
    || !report.childEnv || typeof report.childEnv !== 'object' || Array.isArray(report.childEnv)) {
    throw new Error('Windows capability requires the canonical discovered compiler, SDK and child selection.');
  }
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
  const stages = [];
  try {
    const before = await readInputEvidence(evidenceFiles, signal);
    await fs.writeFile(input, sourceBytes, { flag: 'wx' });
    for (const [name, command, args] of [
      ['compile', compiler, ['/nologo', '/Bv', '/c', '/EHsc', '/std:c++20', '/MD', '/Fo' + object, input]],
      ['link', linker, ['/NOLOGO', '/MACHINE:' + report.arch.toUpperCase(), '/OUT:' + image, object, 'kernel32.lib']]
    ]) {
      signal?.throwIfAborted();
      const result = await spawn(command, args, { cwd: directory, env: childEnv, signal, timeoutMs: 30000,
        outputEncoding: 'utf8', maxOutputBytes: 65536, rejectOnNonZeroExit: false });
      signal?.throwIfAborted();
      stages.push({ stage: name, command, args, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
      if (result.exitCode !== 0 || result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated) throw new Error(`Selected Windows ${name} capability failed; see stage evidence.`);
    }
    const objectResult = await readTargetEvidence(object, report.arch, { signal });
    const imageResult = await readTargetEvidence(image, report.arch, { signal, executable: true });
    const targets = [objectResult.target, imageResult.target];
    const after = await readInputEvidence(evidenceFiles, signal);
    if (before.some((file, index) => file.sha256 !== after[index].sha256)) throw new Error('Selected compiler/header/library bytes changed during capability verification.');
    const receipt = { schemaVersion: 1, kind: 'windows-compiler-capability', state: 'compile-link-target-verified',
      platform: report.platform, arch: report.arch, directory, source: { bytes: sourceBytes.length, sha256: hash(sourceBytes) },
      selected: { compiler, linker, toolset, sdk, include, libraries }, files: before,
      outputs: [objectResult.evidence, imageResult.evidence], targets, stages,
      qualification: 'Selected compiler, C++/Windows/UCRT headers, link libraries and output target only; executable not run; native package activation still required.' };
    await fs.writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
    return receipt;
  } catch (value) {
    const error = asError(value), observe = captureWindowsResourceObservation(error);
    throw addStorageFailureContext(error, { windowsCapability: {
      directory, stages, state: observe && !observe() ? 'teardown-pending' : 'failed', outputsRetained: true
    } });
  }
};

export const verifyWindowsCompilerCapability = async (report, options = {}) => {
  if (!path.isAbsolute(options.scratchRoot || '')) throw new Error('Windows capability requires an absolute run-owned scratch parent.');
  const layout = resolveStorageLayout();
  const state = layout.descriptors.state.path;
  let session, admitted = null;
  let overflow = false;
  const observations = [], observed = new WeakSet();
  const remember = error => {
    if (observed.has(error)) return;
    observed.add(error);
    const observe = captureWindowsResourceObservation(error);
    if (observe) { if (observations.length < 128) observations.push(observe); else overflow = true; }
  };
  const resourcesSettled = () => !overflow && observations.every(observe => observe());
  try { session = await runWithStorageSession({ roots: [options.scratchRoot], coordinationRoot: path.join(state, 'storage-access'),
    authorizedRoots: [options.scratchRoot, state], scope: 'windows-compiler-capability' },
  async held => {
    admitted = held;
    try { return await verifyWindowsCompilerCapabilityOwned(report, options); }
    catch (value) { const error = asError(value); remember(error); throw error; }
  }, { settlement: ({ resourceId }) => {
    const settled = resourcesSettled();
    return { resourceId, settled, pending: !settled };
  } }); } catch (value) {
    const error = asError(value);
    let held, settlementFailure;
    try { held = error.storageSession; settlementFailure = error.storageSettlementError; }
    catch (inspectionError) { throw addStorageFailureContext(error, { windowsCapabilityContextError: asError(inspectionError) }, inspectionError); }
    if (!held || !(held === admitted || isStorageSessionReleaseFailure(error, held)
      || isStorageSessionReleaseFailure(settlementFailure, held))) throw error;
    let released = false, releasing = null;
    const settled = () => released && resourcesSettled();
    const retainFailure = secondary => {
      const pending = Object.assign(new Error('Windows capability resource or metadata release remains pending.', { cause: secondary || error }), {
        cacheOwnershipPending: true, cacheOwnershipReleased: settled
      });
      return addStorageFailureContext(error, { windowsCapabilitySession: recovery,
        ...(secondary ? { windowsCapabilityReleaseError: secondary } : {}) }, pending,
      { nonEnumerable: ['windowsCapabilitySession'] });
    };
    const recovery = Object.freeze({ resourceId: held.resourceId, releaseAfterClosure: async () => {
      if (!releasing) releasing = (async () => {
        if (!resourcesSettled()) throw new Error('Actual Windows capability child/tree closure remains pending.');
        if (!released) {
          if (held.releaseAfterSettlement({ resourceId: held.resourceId, settled: true, pending: false }) !== true) {
            throw new Error('Windows capability storage metadata removal was not confirmed.');
          }
          released = true;
        }
        return true;
      })().finally(() => { releasing = null; });
      try { return await releasing; }
      catch (failure) {
        const secondary = asError(failure);
        if (!isStorageSessionReleaseFailure(secondary, held)) remember(secondary);
        throw retainFailure(secondary);
      }
    } });
    capabilitySessions.add(recovery);
    throw retainFailure();
  }
  return session.value;
};
