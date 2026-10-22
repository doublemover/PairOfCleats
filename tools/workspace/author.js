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

const hash = text => createHash('sha256').update(text).digest('hex');
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
  const body = { schemaVersion: 1, kind: 'workspace-authoring-plan', operation, workspacePath,
    inputHash: before === null ? null : hash(before), outputHash: hash(after), content: after,
    repoSetId: resolved.repoSetId, repos: resolved.repos, writes: [workspacePath],
    formatting: before === null ? 'new JSON document' : 'membership array rewritten; comments outside repos preserved',
    nextCommands: [['workspace', 'status', '--workspace', workspacePath], ['workspace', 'manifest', '--workspace', workspacePath],
      ['search', '--workspace', workspacePath, '--mode', 'code', '--', '<query from your projects>']] };
  return { ...body, planId: hash(JSON.stringify(body)) };
};

export const applyWorkspaceAuthoring = async plan => {
  const { planId, ...body } = plan;
  if (plan.schemaVersion !== 1 || hash(JSON.stringify(body)) !== planId) throw new Error('Workspace authoring plan identity is invalid.');
  const before = readWorkspaceText(plan.workspacePath);
  if ((before === null ? null : hash(before)) !== plan.inputHash) throw new Error('Workspace changed; review a new plan.');
  if (hash(plan.content) !== plan.outputHash) throw new Error('Workspace plan content changed.');
  resolveWorkspaceConfig(parseJsoncText(plan.content, plan.workspacePath), { workspacePath: plan.workspacePath });
  const lockPath = plan.workspacePath + '.authoring-lock';
  const lock = fs.openSync(lockPath, 'wx', 0o600);
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, planId }));
    await atomicWriteText(plan.workspacePath, plan.content, { mkdir: false, mode: 0o600, createOnly: before === null,
      beforeCommit: () => {
        const latest = readWorkspaceText(plan.workspacePath);
        if ((latest === null ? null : hash(latest)) !== plan.inputHash) throw new Error('Workspace changed during staging; review a new plan.');
      } });
    return { ok: true, workspacePath: plan.workspacePath, workspace: loadWorkspaceConfig(plan.workspacePath), nextCommands: plan.nextCommands };
  } finally {
    fs.closeSync(lock);
    fs.rmSync(lockPath, { force: true });
  }
};

export const runWorkspaceAuthoringCli = async () => {
  const argv = createCli({ scriptName: 'workspace-author', options: WORKSPACE_AUTHOR_OPTIONS }).strictOptions().parse();
  const payload = argv.operation === 'validate' ? { ok: true, workspace: loadWorkspaceConfig(argv.workspace), indexReadiness: 'not-probed' }
    : await (async () => {
      const plan = planWorkspaceAuthoring({ workspacePath: argv.workspace, operation: argv.operation,
        roots: (argv.repo || []).map(String), aliases: (argv.alias || []).map(String) });
      return argv.apply ? await applyWorkspaceAuthoring(plan) : plan;
    })();
  if (argv.json) console.log(JSON.stringify(payload, null, 2));
  else console.error(JSON.stringify(payload, null, 2));
};

if (isDirectExecution(import.meta.url)) runWorkspaceAuthoringCli().catch(error => { console.error(error.message); process.exitCode = 1; });
