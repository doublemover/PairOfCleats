// Source UNVALIDATED. No acquisition or system change occurs while planning.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { stableStringify } from '../../src/shared/stable-json.js';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../../src/shared/locks/file-lock.js';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { WINDOWS_PREREQUISITE_CATALOG } from './windows-prerequisite-catalog.js';
import { verifyWindowsCompilerCapability, captureWindowsResourceObservation, isWindowsCapabilitySession } from './windows-capability.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = value => hash(stableStringify(value));
const asError = value => value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
const failureReason = error => {
  for (const key of ['code', 'message']) { try { const value = error[key]; if (typeof value === 'string') return value; } catch {} }
  return 'Prerequisite input inspection failed.';
};
const base = path.dirname(fileURLToPath(import.meta.url));
const ownSources = ['windows-prerequisite-plan.js', 'windows-prerequisite-catalog.js', 'windows-capability.js', 'preflight.js'];
const signatureScript = '$ErrorActionPreference="Stop"; $p=$env:PAIROFCLEATS_PREREQUISITE_FILE; $s=Get-AuthenticodeSignature -LiteralPath $p; $v=(Get-Item -LiteralPath $p).VersionInfo; @{status=[string]$s.Status;subject=$s.SignerCertificate.Subject;thumbprint=$s.SignerCertificate.Thumbprint;issuer=$s.SignerCertificate.Issuer;productVersion=$v.ProductVersion;fileVersion=$v.FileVersion} | ConvertTo-Json -Compress';

const boundedFile = async (file, maxBytes, signal) => {
  signal?.throwIfAborted();
  const read = await readVerifiedContainedFile(path.parse(file).root, file, { maxBytes, signal });
  if (!read.buffer.length) throw new Error('Prerequisite input must be a nonempty bounded regular file.');
  return { path: file, bytes: read.buffer.length, sha256: read.hash };
};

export const inspectWindowsPrerequisiteInstaller = async (file, { env = process.env, signal = null, spawn = spawnResolvedSubprocess } = {}) => {
  const before = await boundedFile(file, 256 * 1024 * 1024, signal);
  if (!env.SystemRoot) throw new Error('Windows SystemRoot is required for the native signature inspector.');
  const powershell = path.win32.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = await spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', signatureScript], {
    env: { ...env, PAIROFCLEATS_PREREQUISITE_FILE: file }, signal, timeoutMs: 15000,
    outputEncoding: 'utf8', maxOutputBytes: 65536, rejectOnNonZeroExit: false
  });
  signal?.throwIfAborted();
  if (result.exitCode !== 0 || result.outputCapture?.stdout?.truncated) throw new Error('Native prerequisite signature inspection failed.');
  const signature = JSON.parse(String(result.stdout || '').replace(/^\uFEFF/, ''));
  const after = await boundedFile(file, 256 * 1024 * 1024, signal);
  if (before.sha256 !== after.sha256) throw new Error('Installer bytes changed during signature inspection.');
  return { ...before, signature, verification: 'actual-local-bytes-and-native-authenticode' };
};

const discoverTarget = async (request, { env, spawn, signal }) => {
  signal?.throwIfAborted();
  const roots = [...new Set([env['ProgramFiles(x86)'], env.ProgramFiles].filter(Boolean))];
  let locator = null;
  for (const root of roots) {
    signal?.throwIfAborted();
    const candidate = path.win32.join(root, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    try { if ((await fs.stat(candidate)).isFile()) { locator = candidate; break; } } catch { /* Missing locator is explicit below. */ }
  }
  if (!locator) {
    try { await fs.stat(request.installPath); return { state: 'unknown-existing-target', instance: null }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { state: 'absent', instance: null }; }
  }
  signal?.throwIfAborted();
  const result = await spawn(locator, ['-all', '-products', '*', '-format', 'json', '-utf8'], { signal, env,
    timeoutMs: 5000, maxOutputBytes: 1024 * 1024, outputEncoding: 'utf8', rejectOnNonZeroExit: false });
  signal?.throwIfAborted();
  if (result.exitCode !== 0 || result.outputCapture?.stdout?.truncated) throw new Error('Visual Studio target discovery did not complete.');
  const instances = JSON.parse(result.stdout);
  if (!Array.isArray(instances) || instances.length > 256) throw new Error('Invalid Visual Studio target inventory.');
  const instance = instances.find(item => typeof item.installationPath === 'string'
    && path.win32.normalize(item.installationPath).toLowerCase() === path.win32.normalize(request.installPath).toLowerCase());
  if (instance) return { state: 'registered', instance: { instanceId: instance.instanceId, installationPath: instance.installationPath,
    installationVersion: instance.installationVersion, productId: instance.productId, isComplete: instance.isComplete, isLaunchable: instance.isLaunchable } };
  try { await fs.stat(request.installPath); return { state: 'unknown-existing-target', instance: null }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; return { state: 'absent', instance: null }; }
};

/** Canonical signed provider descriptor, never a saved plan's arbitrary argv. */
export const createWindowsPrerequisitePlan = async (input, dependencies = {}) => {
  const platform = dependencies.platform || process.platform;
  const env = dependencies.env || process.env;
  const spawn = dependencies.spawn || spawnResolvedSubprocess;
  const catalog = dependencies.catalog || WINDOWS_PREREQUISITE_CATALOG;
  const signal = dependencies.signal || null;
  signal?.throwIfAborted();
  if (platform !== 'win32') throw new Error('Windows prerequisite repair is only available for an explicitly selected Windows host.');
  if (!input || !['install', 'modify'].includes(input.mode) || !['x64', 'arm64'].includes(input.arch)
    || !path.win32.isAbsolute(input.installPath || '') || !path.win32.isAbsolute(input.bootstrapperPath || '')
    || !path.win32.isAbsolute(input.stateRoot || '')) throw new Error('Prerequisite plan requires mode, target arch, absolute installPath/bootstrapperPath/stateRoot.');
  const request = { mode: input.mode, arch: input.arch, installPath: path.win32.normalize(input.installPath),
    bootstrapperPath: path.win32.normalize(input.bootstrapperPath), stateRoot: path.win32.normalize(input.stateRoot) };
  const blockers = [];
  let installer = null;
  try { installer = await (dependencies.inspectInstaller || inspectWindowsPrerequisiteInstaller)(request.bootstrapperPath, { env, signal, spawn }); }
  catch (value) {
    const error = asError(value), observe = captureWindowsResourceObservation(error);
    if (observe && !observe() || signal?.aborted) throw error;
    blockers.push({ code: 'installer-acquisition-or-inspection-required', reason: failureReason(error), source: catalog.url });
  }
  signal?.throwIfAborted();
  if (installer && (installer.sha256 !== catalog.sha256 || (catalog.bytes !== null && installer.bytes !== catalog.bytes)
    || installer.signature?.status !== 'Valid' || !/(?:^|,\s*)O=Microsoft Corporation(?:,|$)/.test(installer.signature?.subject || '')
    || !/^[a-fA-F0-9]{40,128}$/.test(installer.signature?.thumbprint || ''))) blockers.push({ code: 'installer-identity-or-signature-disagrees' });
  const target = await (dependencies.discoverTarget || discoverTarget)(request, { env, spawn, signal });
  signal?.throwIfAborted();
  if (request.mode === 'install' && target.state !== 'absent') blockers.push({ code: 'install-target-already-present-or-unknown' });
  if (request.mode === 'modify' && (target.state !== 'registered' || target.instance?.productId !== catalog.productId
    || !String(target.instance?.installationVersion || '').startsWith('17.') || target.instance?.isComplete !== true)) blockers.push({ code: 'modify-requires-complete-exact-build-tools-2022-instance' });
  if (catalog.allocation?.complete !== true || !Array.isArray(catalog.allocation.writes) || !catalog.allocation.writes.length) blockers.push({ code: 'deferred-unknown-system-destination-allocation', reason: catalog.allocation?.reason });
  const args = [...(request.mode === 'modify' ? ['modify'] : []), '--wait', '--passive', '--norestart', '--noUpdateInstaller',
    '--installPath', request.installPath, '--channelId', catalog.channelId,
    ...(request.mode === 'modify' ? ['--productId', catalog.productId] : []),
    ...catalog.components[request.arch].flatMap(component => ['--add', component])];
  const sources = await Promise.all(ownSources.map(async file => ({ file, sha256: hash(await fs.readFile(path.join(base, file))) })));
  signal?.throwIfAborted();
  const body = { schemaVersion: 1, kind: 'windows-prerequisite-plan', request, provider: catalog.id,
    catalogIdentity: identity(catalog), implementation: sources, target, installer,
    action: { command: request.bootstrapperPath, args }, blockers,
    review: { scope: 'machine-prerequisites', needsSystemChangeApproval: true, needsInstallerTermsAcceptance: true,
      automaticElevation: false, automaticReboot: false, allocation: catalog.allocation,
      sideEffects: ['Selected Visual Studio Build Tools instance and explicitly listed C++/SDK components', 'Vendor installer package/cache/shared-component locations'],
      unchangedPolicy: ['No security setting or machine default selection is modified by this application.'] },
    acquisition: { ...catalog, localBytesObserved: installer?.bytes || null, downloaded: false },
    next: ['Acquire the exact official pinned bootstrapper separately if missing.', 'Resolve all blockers before an explicitly approved apply.', 'Reboot if the vendor requires it; rerun discovery, compiler capability and locked bootstrap.'],
    verificationLevel: 'read-only-prerequisite-plan' };
  return { ...body, planId: identity(body) };
};

export const applyWindowsPrerequisitePlan = async (approved, { approveSystemChanges = false, acceptInstallerTerms = false,
  signal = null, ...dependencies } = {}) => {
  signal?.throwIfAborted();
  if (!approveSystemChanges || !acceptInstallerTerms) throw new Error('Prerequisite apply needs explicit system-change approval and installer terms acceptance.');
  if (approved?.kind !== 'windows-prerequisite-plan' || approved.schemaVersion !== 1) throw new Error('Unknown prerequisite plan.');
  const current = await createWindowsPrerequisitePlan(approved.request, { ...dependencies, signal });
  const { planId: approvedId, ...approvedBody } = approved;
  const { planId: currentId, ...currentBody } = current;
  if (currentId !== approvedId || identity(approvedBody) !== identity(currentBody)) throw new Error('Prerequisite plan inputs, target, installer or implementation changed; review a fresh plan.');
  if (current.blockers.length) return { schemaVersion: 1, kind: 'windows-prerequisite-result', state: 'blocked', planId: current.planId, blockers: current.blockers, systemChanged: false };
  signal?.throwIfAborted();
  const stateRoot = path.resolve(current.request.stateRoot);
  assertNoSymlinkPath(path.parse(stateRoot).root, stateRoot, { allowMissing: true });
  await fs.mkdir(stateRoot, { recursive: true });
  const lock = await acquireFileLock({ lockPath: path.join(stateRoot, 'windows-prerequisite-apply.lock'), waitMs: 0, staleMs: Number.MAX_SAFE_INTEGER,
    metadata: { scope: 'windows-prerequisite-apply', planId: current.planId } });
  if (!lock) throw new Error('Another prerequisite apply owns this state root.');
  let pending = false;
  let primary = null, released = false, releasing = null, overflow = false;
  const observations = [], observed = new WeakSet(), capabilities = new Set();
  const remember = value => {
    const error = asError(value);
    if (observed.has(error)) return error;
    observed.add(error);
    const observe = captureWindowsResourceObservation(error);
    if (observe) { if (observations.length < 128) observations.push(observe); else overflow = true; }
    try { const capability = error.windowsCapabilitySession; if (isWindowsCapabilitySession(capability)) capabilities.add(capability); }
    catch (inspectionError) {
      overflow = true;
      return addStorageFailureContext(error, { prerequisiteContextError: asError(inspectionError) }, inspectionError);
    }
    return error;
  };
  const resourcesSettled = () => !overflow && observations.every(observe => observe());
  const releaseLock = async () => {
    if (!released) { await releaseFileLockOrThrow(lock); released = true; }
    return true;
  };
  const retainFailure = (value, secondary = null) => {
    const error = asError(value);
    const retained = Object.assign(new AggregateError(secondary ? [secondary] : [], 'Prerequisite resource or apply-lock release remains pending.',
      { cause: secondary || error }), { cacheOwnershipPending: true, cacheOwnershipReleased: () => released && resourcesSettled() });
    return addStorageFailureContext(error, { prerequisiteApplySession: recovery,
      ...(secondary ? { prerequisiteReleaseError: secondary } : {}) }, retained, { nonEnumerable: ['prerequisiteApplySession'] });
  };
  const recovery = Object.freeze({ planId: current.planId, releaseAfterClosure: async () => {
    if (!releasing) releasing = (async () => {
      for (const capability of capabilities) {
        if (await capability.releaseAfterClosure() !== true) throw new Error('Actual prerequisite capability owner did not confirm release.');
      }
      if (!resourcesSettled()) throw new Error('Actual prerequisite child/tree closure remains pending.');
      return releaseLock();
    })().finally(() => { releasing = null; });
    try { return await releasing; }
    catch (value) { const error = remember(value); throw retainFailure(primary || error, error); }
  } });
  try {
    signal?.throwIfAborted();
    // Recheck actual pinned bytes after exclusion. Never execute saved arbitrary argv.
    const rechecked = await createWindowsPrerequisitePlan(current.request, { ...dependencies, signal });
    if (rechecked.planId !== current.planId) throw new Error('Prerequisite state changed during apply admission.');
    signal?.throwIfAborted();
    const result = await (dependencies.spawn || spawnResolvedSubprocess)(current.action.command, current.action.args, {
      cwd: stateRoot, env: dependencies.env || process.env, signal, outputEncoding: 'utf8', maxOutputBytes: 1024 * 1024,
      rejectOnNonZeroExit: false, timeoutMs: 30 * 60 * 1000
    });
    signal?.throwIfAborted();
    const code = result.exitCode;
    const state = code === 0 ? 'installed-reverification-required' : code === 3010 ? 'reboot-required' : code === 1641 ? 'reboot-initiated'
      : [1001, 1618].includes(code) ? 'another-installation-running' : code === 740 ? 'elevation-required'
        : [1602, 5004].includes(code) ? 'cancelled' : code === 1003 ? 'selected-instance-in-use' : 'installer-failed';
    const outcome = { schemaVersion: 1, kind: 'windows-prerequisite-result', attemptId: randomUUID(), planId: current.planId, state, vendorExitCode: code,
      installer: current.installer, target: current.target, childSettled: true, readinessRecorded: false,
      next: current.next, systemChanged: [0, 3010, 1641].includes(code) ? true : 'vendor-operation-may-have-partially-changed-state' };
    if (code === 0) {
      if (typeof dependencies.discover !== 'function') throw new Error('Prerequisite apply requires the canonical post-install discovery owner.');
      const discovery = await dependencies.discover();
      signal?.throwIfAborted();
      if (discovery?.platform !== 'win32' || discovery.arch !== current.request.arch
        || path.win32.normalize(discovery.toolchain?.compiler?.installationPath || '').toLowerCase() !== current.request.installPath.toLowerCase()) {
        throw new Error('Post-install discovery did not select the exact reviewed Windows instance/target; repair the explicit selection before bootstrap.');
      }
      outcome.capability = await (dependencies.verifyCapability || verifyWindowsCompilerCapability)(discovery, { scratchRoot: path.join(stateRoot, 'capability'), signal });
      signal?.throwIfAborted();
      if (outcome.capability?.schemaVersion !== 1 || outcome.capability.kind !== 'windows-compiler-capability'
        || outcome.capability.state !== 'compile-link-target-verified' || outcome.capability.platform !== 'win32'
        || outcome.capability.arch !== current.request.arch
        || outcome.capability.selected?.compiler !== discovery.toolchain.compiler.executable) {
        throw new Error('Selected Windows compiler capability did not return its canonical verified target receipt.');
      }
      outcome.childEnv = discovery.childEnv;
      outcome.state = 'prerequisites-verified-locked-bootstrap-required';
    }
    await fs.writeFile(path.join(stateRoot, current.planId + '-' + outcome.attemptId + '-result.json'), JSON.stringify(outcome, null, 2), { flag: 'wx' });
    return outcome;
  } catch (value) {
    const error = remember(value);
    pending = !resourcesSettled();
    primary = addStorageFailureContext(error, { prerequisiteOutcome: { planId: current.planId,
      state: pending ? 'teardown-pending' : signal?.aborted ? 'cancelled' : 'failed', systemChanged: 'unknown', readinessRecorded: false } });
    throw pending ? retainFailure(primary) : primary;
  } finally {
    if (!pending) {
      try { await releaseLock(); }
      catch (value) { const error = asError(value); throw retainFailure(primary || error, error); }
    }
  }
};
