#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { applyEdits, modify } from 'jsonc-parser';
import { createCli } from '../../src/shared/cli.js';
import { parseJsoncText } from '../../src/shared/jsonc.js';
import { loadWorkspaceConfig, resolveWorkspaceConfig } from '../../src/workspace/config.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { atomicWriteText } from '../../src/shared/io/atomic-write.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../../src/shared/locks/file-lock.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { createWorkspaceNextCommands } from './diagnostics.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';

const hash = text => createHash('sha256').update(text).digest('hex');
const identifyMembers = workspace => workspace.repos.map(repo => {
  const stat = fs.statSync(repo.repoRootCanonical, { bigint: true });
  if (!stat.isDirectory()) throw new Error('Workspace members must remain directories.');
  return { repoId: repo.repoId, root: fs.realpathSync(repo.repoRootCanonical),
    device: String(stat.dev), inode: String(stat.ino), createdNs: String(stat.birthtimeNs) };
});
export const WORKSPACE_AUTHOR_OPTIONS = {
  workspace: { type: 'string', demandOption: true }, operation: { type: 'string', choices: ['init', 'add', 'validate'], default: 'init' },
  repo: { type: 'array' }, alias: { type: 'array' }, apply: { type: 'boolean', default: false }, json: { type: 'boolean', default: false }
};
const readWorkspaceText = file => {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Workspace authoring requires a bounded regular config file.');
    return fs.readFileSync(file, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

export const planWorkspaceAuthoring = ({ workspacePath, operation = 'init', roots = [], aliases = [] } = {}) => {
  workspacePath = path.resolve(workspacePath);
  if (!['init', 'add'].includes(operation)) throw new Error('Workspace authoring supports init/add.');
  if (!roots.length) throw new Error('Select at least one explicit repository root.');
  if (aliases.length > roots.length) throw new Error('Each alias must correspond to an explicitly selected root.');
  const before = readWorkspaceText(workspacePath);
  if (operation === 'init' && before !== null) throw new Error('Workspace already exists; use add to preserve existing membership/settings.');
  if (operation === 'add' && before === null) throw new Error('Workspace does not exist; use init.');
  const config = before === null ? { schemaVersion: 1, repos: [] } : parseJsoncText(before, workspacePath);
  if (!Array.isArray(config.repos)) throw new Error('Existing workspace repos must be an array.');
  const repos = [...config.repos, ...roots.map((root, index) => {
    const canonical = fs.realpathSync(root);
    const relative = path.relative(path.dirname(workspacePath), canonical);
    const serialized = relative && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : canonical;
    return { root: serialized, ...(aliases[index] ? { alias: aliases[index] } : {}) };
  })];
  const resolved = resolveWorkspaceConfig({ ...config, repos }, { workspacePath });
  const after = before === null ? JSON.stringify({ ...config, repos }, null, 2) + '\n'
    : applyEdits(before, modify(before, ['repos'], repos, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  const commands = createWorkspaceNextCommands(resolved);
  const body = { schemaVersion: 1, kind: 'workspace-authoring-plan', operation, workspacePath,
    inputHash: before === null ? null : hash(before), outputHash: hash(after), content: after,
    repoSetId: resolved.repoSetId, workspaceConfigHash: resolved.workspaceConfigHash,
    memberIdentities: identifyMembers(resolved), repos: resolved.repos, writes: [workspacePath],
    formatting: before === null ? 'new JSON document' : 'membership array rewritten; comments outside repos preserved',
    commands,
    nextCommands: [commands.status, commands.refreshManifest, commands.search] };
  return { ...body, planId: hash(JSON.stringify(body)) };
};

export const applyWorkspaceAuthoring = async (plan, { signal = null } = {}) => {
  signal?.throwIfAborted();
  const { planId, ...body } = plan;
  if (plan.schemaVersion !== 1 || hash(JSON.stringify(body)) !== planId) throw new Error('Workspace authoring plan identity is invalid.');
  const before = readWorkspaceText(plan.workspacePath);
  if ((before === null ? null : hash(before)) !== plan.inputHash) throw new Error('Workspace changed; review a new plan.');
  if (hash(plan.content) !== plan.outputHash) throw new Error('Workspace plan content changed.');
  const assertReviewedMembership = () => {
    signal?.throwIfAborted();
    const resolved = resolveWorkspaceConfig(parseJsoncText(plan.content, plan.workspacePath), { workspacePath: plan.workspacePath });
    if (resolved.repoSetId !== plan.repoSetId || resolved.workspaceConfigHash !== plan.workspaceConfigHash
      || stableStringify(identifyMembers(resolved)) !== stableStringify(plan.memberIdentities)) {
      throw new Error('Workspace member identities changed; review a new plan.');
    }
    return resolved;
  };
  assertReviewedMembership();
  const lock = await acquireFileLock({ lockPath: plan.workspacePath + '.authoring-lock', waitMs: 0, signal,
    metadata: { scope: 'workspace-authoring', planId } });
  if (!lock) throw new Error('Another workspace authoring owner is active; review a new plan after it settles.');
  try {
    await atomicWriteText(plan.workspacePath, plan.content, { mkdir: false, mode: 0o600, createOnly: before === null,
      beforeCommit: () => {
        assertReviewedMembership();
        const latest = readWorkspaceText(plan.workspacePath);
        if ((latest === null ? null : hash(latest)) !== plan.inputHash) throw new Error('Workspace changed during staging; review a new plan.');
      } });
    return { ok: true, workspacePath: plan.workspacePath, workspace: loadWorkspaceConfig(plan.workspacePath),
      nextCommands: plan.nextCommands, commands: plan.commands };
  } finally {
    await releaseFileLockOrThrow(lock);
  }
};

export const runWorkspaceAuthoringCli = async (rawArgs = process.argv.slice(2)) => {
  const argv = createCli({ argv: ['node', 'workspace-author', ...rawArgs], scriptName: 'workspace-author', options: WORKSPACE_AUTHOR_OPTIONS }).strictOptions().parse();
  let payload;
  try {
    if (argv.operation === 'validate' && (argv.apply || argv.repo?.length || argv.alias?.length)) throw new Error('Workspace validate is read-only and does not accept membership/apply choices.');
    if (argv.operation === 'validate') {
      const workspace = loadWorkspaceConfig(argv.workspace);
      payload = { ok: true, workspace, indexReadiness: 'not-probed', commands: createWorkspaceNextCommands(workspace) };
    } else {
      const plan = planWorkspaceAuthoring({ workspacePath: argv.workspace, operation: argv.operation,
        roots: (argv.repo || []).map(String), aliases: (argv.alias || []).map(String) });
      payload = argv.apply ? await applyWorkspaceAuthoring(plan) : plan;
    }
  } catch (error) {
    const failure = describeStorageFailure(error, { phase: 'workspace-authoring-cli', defaultCode: 'ERR_WORKSPACE_AUTHORING' });
    payload = { ok: false, kind: 'workspace-authoring-result', state: 'blocked', operation: argv.operation,
      workspacePath: path.resolve(argv.workspace), error: failure,
      nextAction: 'Resolve the reported membership/configuration error, then review a new workspace plan.' };
    process.exitCode = 1;
  }
  if (argv.json) console.log(JSON.stringify(payload, null, 2));
  else console.error(JSON.stringify(payload, null, 2));
  return payload;
};

if (isDirectExecution(import.meta.url)) runWorkspaceAuthoringCli().catch(error => { console.error(error.message); process.exitCode = 1; });
