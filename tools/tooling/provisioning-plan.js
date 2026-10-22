import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../src/shared/stable-json.js';
import { findBinaryOnPath } from '../../src/index/tooling/binary-utils.js';
import { resolveInstallerRequirementProbeArgs, verifyInstallerRequirementProbe } from './install-requirements.js';
import { resolveNoProvisionToolingEnvironment } from '../../src/shared/toolchain-env.js';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { readVerifiedContainedFileSync } from '../../src/shared/contained-file.js';

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
    if (!action || typeof action !== 'object' || !action.cmd) return [scope, action];
    const requires = action.requires || (action.cmd === 'npm' ? 'npm' : null);
    const prerequisites = [...(action.prerequisites || [])];
    if (requires === 'npm') prerequisites.push({ id: 'node', command: process.execPath, family: 'node', kind: 'runtime', phase: 'install', dependsOn: [] });
    if (requires && !prerequisites.some(entry => entry.id === requires)) prerequisites.push({
      id: requires, command: requires, family: requires, kind: 'package-manager', phase: 'install',
      dependsOn: requires === 'npm' ? ['node'] : [], minimumGoVersion: action.minimumGoVersion || null
    });
    return [scope, { ...action, requires, prerequisites }];
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
    const prior = nodes.get(input.id);
    if (prior && (prior.command !== input.command || prior.family !== input.family)) throw new Error(`Conflicting prerequisite declarations: ${input.id}`);
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

export const createToolProvisioningPlan = ({ tool, selection, probe = null, resolve = findBinaryOnPath,
  isAllowed = () => true, env = process.env, signal = null } = {}) => {
  signal?.throwIfAborted();
  const declared = [...(tool.prerequisites || []).filter(entry => entry.phase !== 'analysis'), ...(selection.plan?.prerequisites || [])];
  const requirements = orderProvisioningRequirements(declared);
  const steps = requirements.map(requirement => {
    signal?.throwIfAborted();
    const command = path.isAbsolute(requirement.command) ? requirement.command : resolve(requirement.command);
    if (!command || !isAllowed(command)) return { ...requirement, state: 'missing', reason: 'command-missing-or-untrusted',
      nextAction: requirement.systemAction || requirement.recipe || 'No qualified managed recipe is declared for this requirement/platform.' };
    let executable;
    try { executable = identifyProvisioningExecutable(command, { signal }); }
    catch (error) {
      if (signal?.aborted || error.cacheOwnershipPending === true) throw error;
      return { ...requirement, command, state: 'missing', reason: 'command-bytes-unavailable',
        errorCode: error.code || 'ERR_PREREQUISITE_BYTES', nextAction: 'Repair the exact selected command path, then re-plan; no fallback was executed.' };
    }
    const selected = executable.path;
    if (!isAllowed(selected)) return { ...requirement, command: selected, state: 'missing', reason: 'command-missing-or-untrusted',
      nextAction: 'The resolved physical prerequisite is not trusted; select an approved runtime and re-plan.' };
    if (!probe) return { ...requirement, command: selected, state: 'not-probed', verificationLevel: null, executable };
    let verification = null;
    for (const args of resolveInstallerRequirementProbeArgs(requirement.family || requirement.id)) {
      signal?.throwIfAborted();
      if (!sameExecutable(identifyProvisioningExecutable(selected, { signal }), executable)) throw new Error('Prerequisite bytes changed before verification: ' + requirement.id);
      const outcome = probe(selected, args, { signal, env: resolveNoProvisionToolingEnvironment(env, { command: selected, providerId: requirement.id }),
        timeoutMs: 4000, maxOutputBytes: 65536, stdio: 'pipe', outputEncoding: 'utf8' });
      signal?.throwIfAborted();
      if (!sameExecutable(identifyProvisioningExecutable(selected, { signal }), executable)) throw new Error('Prerequisite bytes changed during verification: ' + requirement.id);
      verification = verifyInstallerRequirementProbe(requirement.family || requirement.id, outcome, requirement);
      if (verification.ok) return { ...requirement, command: selected, args, state: 'verified', ...verification, executable };
    }
    return { ...requirement, command: selected, state: 'incompatible', ...verification,
      nextAction: 'Retain explicit selections; repair the reported runtime/components, then re-plan.' };
  });
  const body = { schemaVersion: 1, kind: 'tool-provisioning-plan', toolId: tool.id, scope: selection.scope,
    platform: process.platform, arch: process.arch, steps, action: selection.plan || null,
    state: steps.every(step => step.state === 'verified') ? 'requirements-verified' : 'blocked-or-unprobed' };
  return { ...body, planId: digest(stableStringify(body)) };
};

export const bindProvisioningCommand = (action, plan, baseEnv = process.env) => {
  const manager = plan.steps.find(step => step.id === action.requires && step.state === 'verified');
  const childEnv = { ...baseEnv, ...(action.env || {}) };
  const directories = [...new Set(plan.steps.filter(step => step.state === 'verified').map(step => path.dirname(step.executable.path)))];
  const pathKey = Object.keys(childEnv).find(key => key.toLowerCase() === 'path') || 'PATH';
  childEnv[pathKey] = [...directories, childEnv[pathKey] || ''].filter(Boolean).join(path.delimiter);
  for (const step of plan.steps.filter(entry => entry.state === 'verified')) {
    const current = identifyProvisioningExecutable(step.executable.path);
    if (!sameExecutable(current, step.executable)) throw new Error(`Prerequisite bytes changed after verification: ${step.id}`);
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
    const truncated = result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated;
    return { ok: result.exitCode === 0 && !truncated, outcome: truncated ? 'output-limit' : result.exitCode === 0 ? 'ok' : 'nonzero',
      status: result.exitCode, signal: result.signal || null, errorCode: null, stdout: result.stdout || '', stderr: result.stderr || '' };
  } catch (error) {
    if (error.cacheOwnershipPending || options.signal?.aborted) throw error;
    return { ok: false, outcome: error.name === 'SubprocessTimeoutError' ? 'timeout' : error.code === 'ENOENT' ? 'missing' : 'spawn-error',
      status: error.result?.exitCode ?? null, signal: error.result?.signal || null, errorCode: error.code || null,
      stdout: error.result?.stdout || '', stderr: error.result?.stderr || '' };
  }
};

export const verifyToolProvisioningPlan = async (plan, { env = process.env, signal = null, cwd = process.cwd(), probe = probeProvisioningCommand } = {}) => {
  const steps = [];
  for (const step of plan.steps) {
    signal?.throwIfAborted();
    if (step.state === 'missing') { steps.push(step); continue; }
    if (!step.executable || !sameExecutable(identifyProvisioningExecutable(step.executable.path, { signal }), step.executable)) throw new Error('Prerequisite bytes changed before async verification: ' + step.id);
    let verification = null, acceptedArgs = null;
    for (const args of resolveInstallerRequirementProbeArgs(step.family || step.id)) {
      signal?.throwIfAborted();
      const command = step.executable.path;
      const result = await probe(command, args, { cwd, signal, env: resolveNoProvisionToolingEnvironment(env, { command, providerId: step.id }),
        timeoutMs: 4000, maxOutputBytes: 65536 });
      signal?.throwIfAborted();
      if (!sameExecutable(identifyProvisioningExecutable(command, { signal }), step.executable)) throw new Error('Prerequisite bytes changed during async verification: ' + step.id);
      verification = verifyInstallerRequirementProbe(step.family || step.id, result, step);
      if (verification.ok) { acceptedArgs = args; break; }
    }
    steps.push({ ...step, command: step.executable.path, ...verification, state: verification?.ok ? 'verified' : 'incompatible',
      ...(acceptedArgs ? { args: acceptedArgs } : { nextAction: 'Repair the exact selected runtime/components, then re-plan.' }) });
  }
  const { planId: _previousIdentity, ...body } = plan;
  const updated = { ...body, steps, state: steps.every(step => step.state === 'verified') ? 'requirements-verified' : 'blocked-or-unprobed' };
  return { ...updated, planId: digest(stableStringify(updated)) };
};
