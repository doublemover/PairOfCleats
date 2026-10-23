import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKSPACE_INDEX_MODES } from '../../src/workspace/manifest.js';
import { WORKSPACE_ERROR_CODES } from '../../src/workspace/config.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'pairofcleats.js');
const command = (...args) => [process.execPath, CLI, ...args];

export const createWorkspaceBuildRecovery = (workspace, report, buildArgs) => ({
  state: report.outcome === 'settlement-pending' ? 'wait-for-actual-child-settlement'
    : report.entries.some(entry => entry.errorCode === WORKSPACE_ERROR_CODES.MEMBER_CHANGED) ? 'membership-review-required' : 'explicit-retry-available',
  status: command('workspace', 'status', '--workspace', workspace.workspacePath),
  membershipReview: report.entries.filter(entry => entry.errorCode === WORKSPACE_ERROR_CODES.MEMBER_CHANGED)
    .map(entry => ({ repoId: entry.repoId, repoRootCanonical: entry.repoRootCanonical,
      reason: 'member-directory-changed', command: command('workspace', 'validate', '--workspace', workspace.workspacePath) })),
  retryCandidates: report.outcome === 'settlement-pending' ? [] : [...report.entries.filter(entry => entry.status !== 'passed'
    && entry.errorCode !== WORKSPACE_ERROR_CODES.MEMBER_CHANGED), ...report.skipped]
    .sort((a, b) => a.repoId.localeCompare(b.repoId)).map(entry => ({ repoId: entry.repoId,
      repoRootCanonical: entry.repoRootCanonical, reason: entry.reason || entry.status,
      command: command('index', 'build', ...buildArgs, '--repo', entry.repoRootCanonical) }))
});

export const createWorkspaceNextCommands = workspace => ({
  validate: command('workspace', 'validate', '--workspace', workspace.workspacePath),
  status: command('workspace', 'status', '--workspace', workspace.workspacePath),
  build: command('workspace', 'build', '--workspace', workspace.workspacePath, '--mode', 'code', '--incremental'),
  refreshManifest: command('workspace', 'manifest', '--workspace', workspace.workspacePath),
  search: command('search', '--workspace', workspace.workspacePath, '--mode', 'code', '--', '<query from your projects>'),
  members: workspace.repos.map(repo => ({ repoId: repo.repoId, alias: repo.alias || null, enabled: repo.enabled !== false,
    // --select adds members to the default set; repo-filter actually narrows it.
    search: command('search', '--workspace', workspace.workspacePath, '--repo-filter', repo.repoId,
      '--mode', 'code', '--', '<query from this project>') }))
});

/** Manifest inventory is actionable evidence, not backend or inference validation. */
export const describeWorkspaceReadiness = (workspace, manifest) => {
  const byId = new Map(manifest.repos.map(repo => [repo.repoId, repo]));
  const failures = new Map((manifest.diagnostics?.errors || []).map(error => [error.repoId, error]));
  const nextActions = workspace.repos.flatMap(repo => WORKSPACE_INDEX_MODES.map(mode => {
    const entry = byId.get(repo.repoId)?.indexes?.[mode];
    const failure = failures.get(repo.repoId);
    const memberChanged = failure?.code === WORKSPACE_ERROR_CODES.MEMBER_CHANGED;
    const reason = memberChanged ? 'member-directory-changed' : failure ? 'member-inspection-failed' : entry?.availabilityReason || 'missing-index-dir';
    const state = repo.enabled === false ? 'disabled' : reason === 'present' ? 'ready'
      : reason.startsWith('missing-') ? 'missing' : 'incompatible';
    return { repoId: repo.repoId, alias: repo.alias || null, repoRootCanonical: repo.repoRootCanonical, mode, state,
      reason: repo.enabled === false ? 'disabled-membership' : reason, verification: 'manifest-inventory-only',
      ...(failure ? { inspectionFailure: { code: failure.code, message: failure.message } } : {}),
      command: state !== 'disabled' && memberChanged ? command('workspace', 'validate', '--workspace', workspace.workspacePath)
        : state !== 'disabled' && failure ? command('config', 'validate', '--repo', repo.repoRootCanonical) : ['missing', 'incompatible'].includes(state)
          ? command('index', 'build', '--repo', repo.repoRootCanonical, '--mode', mode, '--incremental') : null,
      validateCommand: state === 'ready' ? command('index', 'validate', '--repo', repo.repoRootCanonical, '--mode', mode) : null,
      consequence: state === 'disabled' ? 'Excluded from default workspace search.' : memberChanged
        ? 'Reload the workspace and review the replacement directory before building or searching this member.' : state === 'ready'
          ? 'Available in the manifest inventory; search performs generation/backend admission.'
          : 'This member/mode cannot contribute results; search can be partial or fail under strict admission.' };
  })).sort((a, b) => a.repoId.localeCompare(b.repoId) || a.mode.localeCompare(b.mode));
  const modes = Object.fromEntries(WORKSPACE_INDEX_MODES.map(mode => {
    const entries = nextActions.filter(entry => entry.mode === mode);
    const count = state => entries.filter(entry => entry.state === state).length;
    const selected = entries.filter(entry => entry.state !== 'disabled').length;
    return [mode, { selected, ready: count('ready'), missing: count('missing'), incompatible: count('incompatible'),
      disabled: count('disabled'), state: !selected ? 'no-members' : entries.some(entry => ['missing', 'incompatible'].includes(entry.state)) ? 'incomplete' : 'ready' }];
  }));
  return { nextActions, modes, nextCommands: createWorkspaceNextCommands(workspace),
    qualification: 'Read-only manifest inventory. Index validation, first results, provider inference and cross-repository graph resolution are not inferred.' };
};
