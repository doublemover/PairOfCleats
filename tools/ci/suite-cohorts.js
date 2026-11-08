import { createHash } from 'node:crypto';

export const CORRECTNESS_SHARDS = 4;
export const STEP_COHORTS = Object.freeze({
  'Capability gate': 'tooling',
  'Tooling doctor gate': 'tooling',
  'Tooling provider API integration': 'tooling',
  'Tooling LSP SLO gate': 'tooling',
  'Tooling LSP replay gate': 'tooling',
  'Tooling LSP default-enable gate': 'tooling',
  'Tooling LSP bench guardrail': 'tooling',
  'Import resolution SLO gate': 'tooling',
  'Serial compiler/build CLI contracts': 'compiler',
  'Serial runtime budgets': 'runtime',
  'CI test lane': 'correctness',
  'Serial ANN generation': 'ann',
  'Serial native lifecycle': 'native',
  'API contract cohort': 'api',
  'Coverage policy report': 'aggregate'
});

const exact = ids => ids.flatMap(id => ['--match', `/^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('/', '\\/')}$/`]);
const testStep = (label, cohort, selectors, report) => ({ label, cohort, command: process.execPath,
  args: ['tests/run.js', '--lane', 'all', ...selectors, '--jobs', '1', '--pairofcleats-threads', '1',
    '--timeout-ms', '30000', '--retries', '0', '--native-status-redo=false', '--report-file', `.diagnostics/${report}.json`] });

/** These are the original workflow's explicit owners, moved without changing
 * their selectors, inputs or strict serial execution boundaries.
 */
export const extraPlatformSteps = platform => [
  testStep('Serial LSP shutdown ownership qualification', 'lsp-shutdown', [
    '--match', '/^tooling\\/lsp\\/(graceful-exit-after-transport-close\\/|reader-closed-restart-reaps-stale-process$|writer-closed-restart-reaps-stale-process$|shutdown-does-not-respawn-on-closed-transport$)/',
    '--match', '/^tooling\\/doctor\\/handshake-admission-and-cancellation$/'
  ], 'lsp-shutdown-qualification'),
  testStep('Serial crash-log ownership and latency qualification', 'crash-log', [
    '--match', '/^indexing\\/crash-log-(terminal-ownership|state-write-contention|independent-sinks|boundary-controls)(\\/|$)/',
    '--match', '/^perf\\/crash-log-error-latency\\//'
  ], 'crash-log-qualification'),
  ...(platform === 'win32' ? [testStep('Windows subprocess ownership', 'windows-ownership', exact([
    'shared/kill-tree.windows', 'shared/kill-tree.windows-orphan-descendant-fallback', 'shared/kill-tree-windows-snapshot',
    'shared/subprocess/sync-timeout-kills-child-tree', 'shared/locks/windows-delete-pending'
  ]), 'windows-subprocess-ownership')] : [])
];

export const classifySuiteSteps = (steps, usrLabels) => steps.map(step => {
  const cohort = STEP_COHORTS[step.label] || (usrLabels.has(step.label) ? 'usr' : null);
  if (!cohort) throw new Error(`CI step has no cohort owner: ${step.label}`);
  return { ...step, cohort };
});

/** Exact existing platform/optional exclusions, with their qualification owner.
 * All other runtime skips remain failures; each listed fixture must still run.
 */
export const plannedRuntimeSkips = (platform, ids) => {
  const exclusions = {
    'smoke/tantivy': { reason: 'optional Tantivy smoke requires PAIROFCLEATS_TEST_TANTIVY=1 and its installed backend',
      owner: 'Deferred experimental native qualification: #1627' },
    ...(platform === 'win32' ? {
      'shared/subprocess/tracked-leak-fails-process': {
        reason: 'POSIX invalid-signal cleanup leak injection; Windows tracked shutdown has a separate owner.',
        owner: 'Windows windows-ownership cohort; POSIX correctness shards' },
      'cli/general/signal-cleanup': {
        reason: 'POSIX parent-signal cleanup; Windows TerminateProcess requires native acceptance.',
        owner: 'Windows native-inspection and native-index-workflows-windows jobs; POSIX correctness shards' }
    } : {
      'tooling/index/clean-artifacts-multi-repository/windows-locked-reader': {
        reason: 'Windows native sharing qualification; portable reader, builder and custom-backend cases run separately.',
        owner: 'Windows correctness shards; portable clean-artifacts-multi-repository cases on every OS' }
    })
  };
  const selected = new Set(ids);
  return Object.fromEntries(Object.entries(exclusions).filter(([id]) => selected.has(id)));
};

export const planDigest = plan => {
  const { digest, ...payload } = plan;
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
};

/** Longest measured cases first, deterministic ties; retain original relative
 * lane order within each shard. Missing measurements get the median known cost.
 */
export const partitionCorrectness = (ids, timings = {}, count = CORRECTNESS_SHARDS) => {
  if (!Number.isInteger(count) || count < 1 || count > 32 || ids.length < count
    || new Set(ids).size !== ids.length) throw new Error('Invalid correctness partition input.');
  const known = ids.map(id => timings[id]).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1000;
  const weight = id => Number.isFinite(timings[id]) && timings[id] > 0 ? Math.min(timings[id], 30000) : fallback;
  const shards = Array.from({ length: count }, (_, index) => ({ key: `correctness-${index + 1}`, ids: [], estimatedMs: 0 }));
  const assignments = new Map();
  for (const id of [...ids].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const target = [...shards].sort((a, b) => a.estimatedMs - b.estimatedMs || a.key.localeCompare(b.key))[0];
    assignments.set(id, target); target.estimatedMs += weight(id);
  }
  for (const id of ids) assignments.get(id).ids.push(id);
  return shards;
};

export const validatePartition = (expected, groups) => {
  const actual = groups.flatMap(group => group.ids);
  if (actual.length !== expected.length || new Set(actual).size !== actual.length
    || expected.some(id => !actual.includes(id))) throw new Error('Correctness partitions omit or duplicate original cases.');
};

export const validateCaseReport = (expected, report, presetSkips = {}, runtimeSkips = {}) => {
  const rows = report?.tests;
  if (!Array.isArray(rows) || rows.length !== expected.length || new Set(rows.map(row => row.id)).size !== rows.length
    || expected.some(id => !rows.some(row => row.id === id))) throw new Error('Test report omits, duplicates or adds assigned cases.');
  for (const row of rows) {
    const presetSkip = row.status === 'skipped' && Object.hasOwn(presetSkips, row.id) && presetSkips[row.id] === row.skipReason;
    const runtimeSkip = row.status === 'skipped' && Object.hasOwn(runtimeSkips, row.id)
      && runtimeSkips[row.id].reason === row.skipReason && row.attempts === 1 && row.exitCode === 77;
    if ((presetSkip ? ![0, 1].includes(row.attempts) : row.attempts !== 1)
      || row.timedOut !== false || !Number.isFinite(row.durationMs) || row.durationMs < 0 || row.durationMs > 30000
      || row.status !== 'passed' && !presetSkip && !runtimeSkip
      || row.status === 'passed' && row.exitCode !== 0) throw new Error(`Assigned test did not qualify: ${row.id} (${row.status})`);
  }
  if (report.summary?.total !== rows.length || report.summary?.failed !== 0
    || report.summary?.passed !== rows.filter(row => row.status === 'passed').length
    || report.summary?.skipped !== rows.filter(row => row.status === 'skipped').length) throw new Error('Test summary disagrees with its original outcomes.');
};
