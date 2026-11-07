import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isRepoTrusted, isResolvedCommandTrusted } from '../../../shared/config-authority.js';
import { resolveToolRoot } from '../../../shared/dict-utils.js';
import { readVerifiedContainedFile } from '../../../shared/contained-file.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { resolveNoProvisionToolingEnvironment } from '../../../shared/toolchain-env.js';
import { createCommandProbeEnvironmentIdentity } from '../command-probe-persistent-cache.js';
import { resolveToolingCommandProfile } from '../command-resolver.js';

const plans = new WeakMap();
const fail = message => Object.assign(new Error(message), { code: 'ERR_SOURCEKIT_OPERATION_PLAN' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestIdentity = async (repoRoot, signal) => {
  try { return hash((await readVerifiedContainedFile(repoRoot, path.join(repoRoot, 'Package.swift'), {
    maxBytes: 2 * 1024 * 1024, signal
  })).buffer); }
  catch (error) { if (error.code === 'ENOENT') return '<absent>'; throw error; }
};
const toolIdentity = async command => {
  const canonical = await fs.realpath(command);
  const stat = await fs.stat(canonical, { bigint: true });
  if (!stat.isFile()) throw fail('Selected Swift command must be a regular executable.');
  return `${canonical}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
};
const admitted = (repoRoot, command) => isRepoTrusted(repoRoot)
  && isResolvedCommandTrusted({ repoRoot, commandPath: command, toolRoot: resolveToolRoot() });

/** Explicit host operation, never a repository config knob or saved receipt.
 * Creating this plan authorizes the fixed `swift package resolve` operation and
 * SourceKit workspace loading for the exact trusted root. Workspace loading may
 * evaluate manifests/build-server hooks/plugins; it is not passive analysis or
 * an offline/build/compiler qualification. No ordinary index path creates one. */
export const createSourcekitOperationPlan = async ({ repoRoot, swiftCommand, allowWorkspaceLoad = false,
  toolingConfig = {}, signal = null }) => {
  throwIfAborted(signal);
  const root = await fs.realpath(repoRoot);
  if (allowWorkspaceLoad !== true || !path.isAbsolute(swiftCommand || '') || !admitted(root, swiftCommand)) {
    throw fail('SourceKit operation plan requires explicit workspace loading and exact trusted repository/command selection.');
  }
  const command = await fs.realpath(swiftCommand);
  const profile = resolveToolingCommandProfile({ providerId: 'sourcekit', cmd: command, args: ['package', 'resolve'],
    repoRoot: root, toolingConfig });
  throwIfAborted(signal);
  if (profile.resolved?.mode === 'blocked' || profile.probe?.validationFailure
    || profile.probe?.cacheOwnershipPending === true || profile.probe?.ok !== true) {
    throw fail('Selected Swift command is denied, unsettled or has no successful bounded probe.');
  }
  const environment = resolveNoProvisionToolingEnvironment(process.env, { command, providerId: 'sourcekit', cwd: root });
  const record = { root, command, args: ['package', 'resolve'], allowWorkspaceLoad: true,
    manifest: await manifestIdentity(root, signal), tool: await toolIdentity(command),
    environmentIdentity: createCommandProbeEnvironmentIdentity(environment) };
  throwIfAborted(signal);
  if (!admitted(root, command)) throw fail('SourceKit operation authority was revoked during observation.');
  const plan = Object.freeze({ schemaVersion: 1, identity: hash(JSON.stringify(record)),
    purpose: 'explicit-swift-package-resolution-and-workspace-load' });
  plans.set(plan, record);
  return plan;
};

/** Revalidate original host authority without invoking a command. Plain JSON,
 * stale manifests, changed executable metadata, another root, environment drift
 * and revoked trust cannot turn into resolving or workspace-loading authority. */
export const verifySourcekitOperationPlan = async (plan, { repoRoot, signal = null } = {}) => {
  throwIfAborted(signal);
  const record = plan && plans.get(plan);
  if (!record || path.resolve(repoRoot || '') !== path.resolve(record.root) || !admitted(record.root, record.command)) {
    throw fail('No current exact SourceKit operation authority.');
  }
  const environment = resolveNoProvisionToolingEnvironment(process.env, { command: record.command,
    providerId: 'sourcekit', cwd: record.root });
  if (await manifestIdentity(record.root, signal) !== record.manifest || await toolIdentity(record.command) !== record.tool
    || createCommandProbeEnvironmentIdentity(environment) !== record.environmentIdentity) throw fail('SourceKit operation plan inputs changed.');
  throwIfAborted(signal);
  if (!admitted(record.root, record.command)) throw fail('SourceKit operation authority was revoked during verification.');
  return Object.freeze({ identity: plan.identity, repoRoot: record.root, command: record.command,
    args: [...record.args], environment });
};
