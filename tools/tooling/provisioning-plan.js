import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import semver from 'semver';
import { stableStringify } from '../../src/shared/stable-json.js';
import { findBinaryOnPath } from '../../src/index/tooling/binary-utils.js';
import { resolveInstallerRequirementProbeArgs, verifyInstallerRequirementProbe } from './install-requirements.js';
import { resolveNoProvisionToolingEnvironment } from '../../src/shared/toolchain-env.js';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { readVerifiedContainedFileSync } from '../../src/shared/contained-file.js';
import { describeProvisioningFailure, isProvisioningObservationFailure, observeProvisioningResource } from './provisioning-failure.js';
import { resolveEnvPath } from '../../src/shared/env-path.js';
import { resolveManagedToolInstallation } from '../../src/shared/managed-installation.js';
import { withManagedProvisioningRequirements } from './provisioning-lifetime.js';
import { bindManagedDotnetEnvironment } from './dotnet-environment.js';
import { runOperationalChildWithStorage } from './operational-storage.js';
import { resolveDeclaredInstallAdmission } from './install-allocation-contract.js';

const digest = value => createHash('sha256').update(value).digest('hex');
export const identifyProvisioningExecutable = (command, { signal = null } = {}) => {
  signal?.throwIfAborted();
  const physical = fs.realpathSync(command);
  const { hash: sha256, stat } = readVerifiedContainedFileSync(path.parse(physical).root, physical,
    { maxBytes: 256 * 1024 * 1024, signal });
  return { path: physical, sha256, size: stat.size };
};
const sameExecutable = (actual, expected) => actual.path === expected.path && actual.sha256 === expected.sha256
  && actual.size === expected.size;

/** A single declaration is attached to the canonical tool registry, not another tool catalog. */
export const normalizeToolProvisioningDeclaration = tool => {
  const install = Object.fromEntries(Object.entries(tool.install || {}).map(([scope, action]) => {
    if (!action || typeof action !== 'object') return [scope, action];
    if (Array.isArray(action)) return [scope, [...action]];
    const allocation = scope === 'cache' ? resolveDeclaredInstallAdmission(action) : null;
    const storageAllocationBlocker = allocation && allocation.state !== 'estimate-declared'
      ? { code: 'recipe-storage-allocation-unqualified', state: allocation.state, owner: 'canonical-product-recipe',
        action: allocation.nextAction, ...(allocation.basis ? { basis: allocation.basis } : {}) } : null;
    const storageFields = storageAllocationBlocker ? { storageAllocationBlocker } : {};
    const normalizedAction = { ...action };
    delete normalizedAction.storageAllocationBlocker;
    if (!action.cmd) return [scope, { ...normalizedAction, ...storageFields }];
    const requires = action.requires || (action.cmd === 'npm' ? 'npm' : null);
    const prerequisites = [...(action.prerequisites || [])];
    if (requires === 'npm') prerequisites.push({ id: 'node', command: process.execPath, family: 'node', kind: 'runtime', phase: 'install', dependsOn: [] });
    if (requires && !prerequisites.some(entry => entry.id === requires)) prerequisites.push({
      id: requires, command: requires, family: requires, kind: 'package-manager', phase: 'install',
      dependsOn: requires === 'npm' ? ['node'] : requires === 'gem' && tool.prerequisites?.some(entry => entry.id === 'ruby') ? ['ruby'] : [],
      minimumGoVersion: action.minimumGoVersion || null
    });
    return [scope, { ...normalizedAction, ...storageFields, requires, prerequisites }];
  }));
  const needsNode = Object.values(install).some(action => action?.requires === 'npm');
  return { ...tool, install, prerequisites: [...(tool.prerequisites || []), ...(needsNode
    ? [{ id: 'node', command: process.execPath, family: 'node', kind: 'runtime', phase: 'launch', dependsOn: [] }] : [])] };
};

/** Deterministic dependency order; phase prevents project-only runtimes gating npm launch. */
export const orderProvisioningRequirements = requirements => {
  const nodes = new Map();
  for (const input of requirements) {
    if (!input?.id || !/^[a-z0-9][a-z0-9.-]*$/.test(input.id)) throw new Error('Invalid provisioning requirement id.');
    for (const key of ['dependsOn', 'requiredComponents']) {
      if (input[key] !== undefined && (!Array.isArray(input[key]) || input[key].length > 256
        || input[key].some(value => typeof value !== 'string' || !value || value.length > 256))) throw new Error('Invalid provisioning prerequisite edge/component declaration.');
    }
    const prior = nodes.get(input.id);
    if (prior && (prior.command !== input.command || prior.family !== input.family)) throw new Error(`Conflicting prerequisite declarations: ${input.id}`);
    if (prior && ['versionRange', 'minimumGoVersion'].some(key => prior[key] && input[key] && prior[key] !== input[key])) {
      throw new Error(`Conflicting prerequisite version constraints: ${input.id}`);
    }
    nodes.set(input.id, prior ? { ...input, ...prior,
      dependsOn: [...new Set([...(prior.dependsOn || []), ...(input.dependsOn || [])])],
      requiredComponents: [...new Set([...(prior.requiredComponents || []), ...(input.requiredComponents || [])])] } : input);
  }
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error('Provisioning dependency cycle: ' + id);
    const node = nodes.get(id);
    if (!node) throw new Error('Undeclared provisioning prerequisite: ' + id);
    visiting.add(id);
    for (const dependency of [...(node.dependsOn || [])].sort()) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(node);
  };
  for (const id of [...nodes.keys()].sort()) visit(id);
  return ordered;
};

const alignRuntimeSelections = steps => {
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
  return steps.map(step => {
    if (step.state !== 'verified') return step;
    const runtime = step.family === 'javac' ? steps.find(candidate => candidate.family === 'java' && candidate.state === 'verified')
      : step.family === 'dotnet' ? steps.find(candidate => candidate.family === 'dotnet-runtime' && candidate.state === 'verified') : null;
    if (!runtime) return step;
    const root = value => step.family === 'javac' ? path.dirname(path.dirname(value.executable.path)) : path.dirname(value.executable.path);
    if (normalize(root(step)) === normalize(root(runtime))) return step;
    return { ...step, state: 'incompatible', ok: false, reason: 'selected-runtime-root-mismatch', runtimeRequirement: runtime.id,
      nextAction: 'Select runtime and SDK/compiler from one physical installation; retain explicit selections and re-plan.' };
  });
};

export const createToolProvisioningPlan = ({ tool, selection, probe = null, resolve = findBinaryOnPath,
  isAllowed = () => true, env = process.env, signal = null } = {}) => {
  signal?.throwIfAborted();
  const declared = [...(tool.prerequisites || []).filter(entry => entry.phase !== 'analysis'), ...(selection.plan?.prerequisites || [])];
  const requirements = orderProvisioningRequirements(declared);
  const resolveStep = requirement => {
    signal?.throwIfAborted();
    const pinKey = path.isAbsolute(requirement.command) ? null : ['dotnet', 'dotnet-runtime'].includes(requirement.family) ? 'DOTNET_ROOT'
      : ['java', 'javac'].includes(requirement.family) ? 'JAVA_HOME' : null;
    const pinnedRoot = pinKey ? String(env[pinKey] || '').trim() : '';
    if (pinnedRoot && !path.isAbsolute(pinnedRoot)) return { ...requirement, state: 'missing', reason: 'invalid-explicit-runtime-root',
      selectedEnvironmentKey: pinKey, nextAction: `${pinKey} must select an absolute runtime root; no PATH fallback was executed.` };
    const pinnedCommand = pinnedRoot ? path.join(pinnedRoot, ...(pinKey === 'JAVA_HOME' ? ['bin'] : []),
      requirement.command + (process.platform === 'win32' ? '.exe' : '')) : null;
    const managedDotnet = !pinnedRoot && !path.isAbsolute(requirement.command) && ['dotnet', 'dotnet-runtime'].includes(requirement.family) && tool.toolingRoot
      ? resolveManagedToolInstallation(tool.toolingRoot, 'dotnet-sdk') : null;
    if (!pinnedRoot && !path.isAbsolute(requirement.command) && !managedDotnet && ['dotnet', 'dotnet-runtime'].includes(requirement.family) && tool.toolingRoot) {
      try {
        fs.lstatSync(path.join(tool.toolingRoot, 'installs', 'dotnet-sdk', 'current.json'));
        return { ...requirement, state: 'missing', reason: 'selected-managed-prerequisite-unavailable',
          nextAction: 'Repair the exact selected managed SDK generation; no ambient host or replacement is selected implicitly.' };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const command = path.isAbsolute(requirement.command) ? requirement.command : pinnedCommand || managedDotnet?.command || resolve(requirement.command, resolveEnvPath(env));
    if (!command || !isAllowed(command)) return { ...requirement, state: 'missing', reason: 'command-missing-or-untrusted',
      ...(command ? { selectedCommandRejected: true } : {}), ...(path.isAbsolute(requirement.command) ? { explicitCommand: true } : {}),
      nextAction: requirement.systemAction || requirement.recipe || 'No qualified managed recipe is declared for this requirement/platform.' };
    let executable;
    try { executable = identifyProvisioningExecutable(command, { signal }); }
    catch (error) {
      const diagnostic = describeProvisioningFailure(error, { signal });
      return { ...requirement, command, state: 'missing', reason: 'command-bytes-unavailable',
        errorCode: diagnostic.code || 'ERR_PREREQUISITE_BYTES', nextAction: 'Repair the exact selected command path, then re-plan; no fallback was executed.' };
    }
    const selected = executable.path;
    const managedInstallation = managedDotnet && command === managedDotnet.command ? { toolingRoot: tool.toolingRoot,
      toolId: 'dotnet-sdk', descriptorId: managedDotnet.descriptorId, installId: managedDotnet.installId } : null;
    if (!isAllowed(selected)) return { ...requirement, command: selected, state: 'missing', reason: 'command-missing-or-untrusted',
      selectedCommandRejected: true,
      nextAction: 'The resolved physical prerequisite is not trusted; select an approved runtime and re-plan.' };
    if (!probe || managedInstallation) return { ...requirement, command: selected, state: 'not-probed', verificationLevel: null, executable,
      ...(managedInstallation ? { managedInstallation } : {}) };
    let verification = null;
    for (const args of resolveInstallerRequirementProbeArgs(requirement.family || requirement.id)) {
      signal?.throwIfAborted();
      if (!sameExecutable(identifyProvisioningExecutable(selected, { signal }), executable)) throw new Error('Prerequisite bytes changed before verification: ' + requirement.id);
      const outcome = probe(selected, args, { signal, env: resolveNoProvisionToolingEnvironment(env, { command: selected, providerId: requirement.id }),
        timeoutMs: 4000, maxOutputBytes: 65536, stdio: 'pipe', outputEncoding: 'utf8' });
      const observation = observeProvisioningResource(outcome, { phase: 'synchronous-prerequisite-probe' });
      observation.requireSettled();
      let then;
      try { then = outcome?.then; }
      catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
      if (typeof then === 'function') throw observation.retain(Object.assign(new Error('Synchronous prerequisite probe returned unknown asynchronous work.'), {
        cacheOwnershipPending: true
      }), { inspectionPresent: true });
      try {
        signal?.throwIfAborted();
        if (!sameExecutable(identifyProvisioningExecutable(selected, { signal }), executable)) throw new Error('Prerequisite bytes changed during verification: ' + requirement.id);
      } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true, inspectionPrimary: true }); }
      try { verification = verifyInstallerRequirementProbe(requirement.family || requirement.id, outcome, { ...requirement, selectedExecutable: executable }); }
      catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
      observation.requireSettled();
      if (verification.ok) return { ...requirement, command: selected, args, state: 'verified', ...verification, executable,
        ...(managedInstallation ? { managedInstallation } : {}) };
    }
    return { ...requirement, command: selected, state: 'incompatible', ...verification,
      ...(managedInstallation ? { managedInstallation } : {}),
      nextAction: 'Retain explicit selections; repair the reported runtime/components, then re-plan.' };
  };
  const steps = [];
  for (const requirement of requirements) {
    const blockedBy = (requirement.dependsOn || []).filter(id => ['missing', 'incompatible', 'blocked'].includes(steps.find(step => step.id === id)?.state));
    steps.push(blockedBy.length ? { ...requirement, state: 'blocked', reason: 'upstream-prerequisite-not-verified', blockedBy,
      nextAction: 'Resolve the selected prerequisite blockers and re-plan before this dependent command is executed.' } : resolveStep(requirement));
  }
  const aligned = alignRuntimeSelections(steps);
  const body = { schemaVersion: 1, kind: 'tool-provisioning-plan', toolId: tool.id, scope: selection.scope,
    platform: process.platform, arch: process.arch, steps: aligned, action: selection.plan || null,
    state: aligned.every(step => step.state === 'verified') ? 'requirements-verified' : 'blocked-or-unprobed' };
  return { ...body, planId: digest(stableStringify(body)) };
};

export const bindProvisioningCommand = (action, plan, baseEnv = process.env) => {
  // Go's existing portable SDK owner binds its separately verified absolute
  // command after acquisition. Other managers cannot use an unverified token.
  const separatelyBoundGo = action.requires === 'go' && path.isAbsolute(action.cmd);
  if (plan.steps.some(step => step.state !== 'verified' && !(separatelyBoundGo && step.id === 'go'))) {
    throw new Error('Provisioning prerequisites are not verified; no installer or consumer command can be bound.');
  }
  const manager = plan.steps.find(step => step.id === action.requires && step.state === 'verified');
  if (action.requires && !manager && !separatelyBoundGo) throw new Error('Selected package manager has no verified physical executable; bare command fallback is forbidden.');
  let childEnv = { ...baseEnv, ...(action.env || {}) };
  const directories = [...new Set(plan.steps.filter(step => step.state === 'verified').map(step => path.dirname(step.executable.path)))];
  const pathKey = Object.keys(childEnv).find(key => key.toLowerCase() === 'path') || 'PATH';
  childEnv[pathKey] = [...directories, childEnv[pathKey] || ''].filter(Boolean).join(path.delimiter);
  for (const step of plan.steps.filter(entry => entry.state === 'verified')) {
    const current = identifyProvisioningExecutable(step.executable.path);
    if (!sameExecutable(current, step.executable)) throw new Error(`Prerequisite bytes changed after verification: ${step.id}`);
  }
  const dotnet = plan.steps.find(step => ['dotnet', 'dotnet-runtime'].includes(step.family) && step.state === 'verified');
  if (dotnet) {
    const root = path.dirname(dotnet.executable.path);
    if (childEnv.DOTNET_ROOT && fs.realpathSync(childEnv.DOTNET_ROOT) !== root) throw new Error('Explicit .NET runtime selection changed after verification.');
    if (dotnet.managedInstallation) childEnv = bindManagedDotnetEnvironment(childEnv, root, dotnet.executable.path);
    else childEnv.DOTNET_ROOT = root;
  }
  const java = plan.steps.find(step => step.family === 'java' && step.state === 'verified');
  if (java) {
    const root = path.dirname(path.dirname(java.executable.path));
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (childEnv.JAVA_HOME && normalize(fs.realpathSync(childEnv.JAVA_HOME)) !== normalize(root)) throw new Error('Explicit Java runtime selection changed after verification.');
    const compiler = plan.steps.find(step => step.family === 'javac' && step.state === 'verified');
    if (compiler && normalize(path.dirname(path.dirname(compiler.executable.path))) !== normalize(root)) throw new Error('Selected Java runtime and compiler belong to different JDK roots; retain explicit pins and re-plan.');
    childEnv.JAVA_HOME = root;
  }
  return { command: manager && action.cmd === action.requires ? manager.executable.path : action.cmd,
    args: action.args, env: childEnv, prerequisites: plan.steps };
};

/** Actual install prerequisites use async children; pending close is never
 * flattened into a retryable missing-command report or installation consent.
 */
export const probeProvisioningCommand = async (command, args, { spawn = spawnResolvedSubprocess, ...options } = {}) => {
  try {
    const result = await spawn(command, args, { ...options, outputEncoding: 'utf8',
      timeoutMs: options.timeoutMs || 4000, maxOutputBytes: options.maxOutputBytes || 65536, rejectOnNonZeroExit: false });
    const observation = observeProvisioningResource(result, { phase: 'prerequisite-probe-result' });
    observation.requireSettled();
    try { options.signal?.throwIfAborted(); }
    catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true, inspectionPrimary: true }); }
    let report;
    try {
      const capture = result.outputCapture, stdoutCapture = capture?.stdout, stderrCapture = capture?.stderr;
      const truncated = stdoutCapture?.truncated || stderrCapture?.truncated;
      const status = result.exitCode, childSignal = result.signal, stdout = result.stdout, stderr = result.stderr;
      report = { ok: status === 0 && !truncated, outcome: truncated ? 'output-limit' : status === 0 ? 'ok' : 'nonzero',
        status, signal: childSignal || null, errorCode: null, stdout: stdout || '', stderr: stderr || '' };
    } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    observation.requireSettled(); return report;
  } catch (error) {
    if (isProvisioningObservationFailure(error)) throw error;
    const diagnostic = describeProvisioningFailure(error, { signal: options.signal, includeResult: true });
    return { ok: false, outcome: diagnostic.name === 'SubprocessTimeoutError' ? 'timeout' : diagnostic.code === 'ENOENT' ? 'missing' : 'spawn-error',
      status: diagnostic.status, signal: diagnostic.signal, errorCode: diagnostic.code,
      stdout: diagnostic.stdout, stderr: diagnostic.stderr };
  }
};

const verifyToolProvisioningPlanOwned = async (plan, { env = process.env, signal = null, cwd = process.cwd(), probe = probeProvisioningCommand } = {}) => {
  const steps = [];
  for (const step of plan.steps) {
    signal?.throwIfAborted();
    const blockedBy = (step.dependsOn || []).filter(id => steps.find(prior => prior.id === id)?.state !== 'verified');
    if (blockedBy.length) {
      steps.push({ ...step, state: 'blocked', reason: 'upstream-prerequisite-not-verified', blockedBy,
        nextAction: 'Resolve the selected prerequisite blockers and re-plan before this dependent command is executed.' });
      continue;
    }
    if (step.state === 'missing') { steps.push(step); continue; }
    if (!step.executable) {
      steps.push({ ...step, state: 'missing', reason: 'prerequisite-selection-unavailable',
        nextAction: 'Re-plan after resolving the prerequisite dependency; no new executable is selected during verification.' });
      continue;
    }
    if (!sameExecutable(identifyProvisioningExecutable(step.executable.path, { signal }), step.executable)) throw new Error('Prerequisite bytes changed before async verification: ' + step.id);
    let verification = null, acceptedArgs = null;
    for (const args of resolveInstallerRequirementProbeArgs(step.family || step.id)) {
      signal?.throwIfAborted();
      const command = step.executable.path;
      const selectedEnv = step.managedInstallation?.toolId === 'dotnet-sdk' ? bindManagedDotnetEnvironment(env, path.dirname(command), command) : env;
      const childEnv = resolveNoProvisionToolingEnvironment(selectedEnv, { command, providerId: step.id });
      const run = routed => probe(command, args, { cwd, signal, env: routed, timeoutMs: 4000, maxOutputBytes: 65536 });
      const result = step.managedInstallation?.toolId === 'dotnet-sdk' ? await runOperationalChildWithStorage({ id: 'dotnet-sdk',
        toolingRoot: step.managedInstallation.toolingRoot, repoRoot: cwd, command, identity: step.executable, env: childEnv, cwd },
      ({ env: routed }) => run(routed)) : await run(childEnv);
      const observation = observeProvisioningResource(result, { phase: 'asynchronous-prerequisite-probe' });
      observation.requireSettled();
      try {
        signal?.throwIfAborted();
        if (!sameExecutable(identifyProvisioningExecutable(command, { signal }), step.executable)) throw new Error('Prerequisite bytes changed during async verification: ' + step.id);
      } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true, inspectionPrimary: true }); }
      try { verification = verifyInstallerRequirementProbe(step.family || step.id, result, { ...step, selectedExecutable: step.executable }); }
      catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
      observation.requireSettled();
      if (verification.ok && step.managedInstallation?.toolId === 'dotnet-sdk') {
        const root = path.dirname(command), normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
        const packs = step.family === 'dotnet' ? verification.identity.sdks : verification.identity.runtimes;
        const owned = packs.filter(pack => !step.versionRange || semver.satisfies(pack.version, step.versionRange));
        if (!owned.some(pack => normalize(pack.path) === normalize(step.family === 'dotnet' ? path.join(root, 'sdk') : path.join(root, 'shared', pack.component)))) {
          verification = { ...verification, ok: false, reason: 'selected-runtime-root-mismatch' };
        }
      }
      if (verification.ok) { acceptedArgs = args; break; }
    }
    steps.push({ ...step, command: step.executable.path, ...verification, state: verification?.ok ? 'verified' : 'incompatible',
      ...(acceptedArgs ? { args: acceptedArgs } : { nextAction: 'Repair the exact selected runtime/components, then re-plan.' }) });
  }
  const { planId: _previousIdentity, ...body } = plan;
  const aligned = alignRuntimeSelections(steps);
  const updated = { ...body, steps: aligned, state: aligned.every(step => step.state === 'verified') ? 'requirements-verified' : 'blocked-or-unprobed' };
  return { ...updated, planId: digest(stableStringify(updated)) };
};

export const verifyToolProvisioningPlan = (plan, options = {}) => withManagedProvisioningRequirements(plan,
  () => verifyToolProvisioningPlanOwned(plan, options), { signal: options.signal, registerRecovery: options.registerRecovery });
