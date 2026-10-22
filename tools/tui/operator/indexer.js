import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getCacheRoot } from '../../../src/shared/dict-utils.js';
import { readVerifiedContainedFileSync, assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { sameIdentityPath } from '../../../src/shared/indexing/build-pointer-roots.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { PRIMARY_INDEX_MODES } from '../../../src/integrations/core/build-index/stages/modes.js';
import { normalizeIndexBuildStage } from '../../../src/shared/indexing/stages.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { loadServiceConfig, resolveRepoRegistry } from '../../service/config.js';
import { resolveRepoPath } from '../../service/repos.js';
import { loadServiceShutdownState } from '../../service/shutdown-state.js';
import { createQueueWorker } from '../../service/indexer-service/queue-worker.js';
import { createJobExecutor } from '../../service/indexer-service/job-executor.js';
import { createJobCompletion } from '../../service/indexer-service/job-completion.js';
import { createServiceRuntimeEnvResolver } from '../../service/indexer-service-helpers.js';
import { resolveQueueLeasePolicy } from '../../service/lease-policy.js';
import { resolveQueueAdmissionPolicy } from '../../service/admission-policy.js';
import { claimNextJob, completeJob, quarantineJob, queueSummary, ensureQueueDir, touchJobHeartbeat } from '../../service/queue.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const directory = target => {
  const resolved = path.resolve(target);
  assertNoSymlinkPath(path.parse(resolved).root, resolved);
  const stat = fs.lstatSync(resolved, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('ERR_TUI_INDEXER_DIRECTORY', 'Indexer authority requires an ordinary directory.');
  return { path: fs.realpathSync.native(resolved), dev: String(stat.dev), ino: String(stat.ino) };
};
const localCancel = () => ({ mode: 'cancel', accepting: false, stopClaiming: true, forceAbort: true, deadlineAt: null });

/** Reuses durable queue claims, lease renewal, canonical executors and completion.
 * Native cancellation changes only this instance's local shutdown observation.
 */
export const createTuiIndexer = ({ toolRoot, requireScope, env = process.env,
  createExecutor = createJobExecutor } = {}) => {
  const active = new Map();
  const prepare = async ({ scope, values, signal }) => {
    requireScope(scope.id); throwIfAborted(signal);
    if (scope.kind !== 'workspace') fail('ERR_TUI_INDEXER_SCOPE', 'Select a workspace to review every registered repository.');
    const configPath = path.resolve(scope.configRoot, values.config);
    const capture = () => {
      requireScope(scope.id);
      const read = readVerifiedContainedFileSync(scope.configRoot, configPath, { maxBytes: 1024 * 1024 });
      const config = loadServiceConfig(configPath);
      // Re-read after the canonical config owner; mixed revisions cannot grant
      // authority even when a file changes during its synchronous read.
      if (readVerifiedContainedFileSync(scope.configRoot, configPath, { maxBytes: 1024 * 1024 }).hash !== read.hash) {
        fail('ERR_TUI_INDEXER_STALE', 'Indexer configuration changed during review.');
      }
      const workspace = loadWorkspaceConfig(scope.target);
      const selected = workspace.repos.filter(repo => repo.enabled).map(repo => repo.repoRootCanonical);
      const baseDir = config.baseDir ? path.resolve(config.baseDir) : path.join(getCacheRoot(), 'service/repos');
      if (!Array.isArray(config.repos)) fail('ERR_TUI_INDEXER_REGISTRY', 'Native ownership requires an inline repository registry in the reviewed service config.');
      const entries = resolveRepoRegistry(config, configPath);
      if (!entries.length || entries.length > 32 || config.security?.allowShell || config.security?.allowPathEscape) {
        fail('ERR_TUI_INDEXER_REGISTRY', 'Choose 1–32 registered repositories with shell/path-escape security disabled.');
      }
      const repos = entries.map(entry => {
        const repoPath = resolveRepoPath(entry, baseDir);
        if (!repoPath) fail('ERR_TUI_INDEXER_REGISTRY', 'Every registered repository needs an existing path.');
        const identity = directory(repoPath);
        if (!selected.some(root => sameIdentityPath(root, identity.path))) {
          fail('ERR_TUI_INDEXER_MEMBERSHIP', 'Every service repository must be an enabled member of the selected workspace.');
        }
        return identity;
      });
      if (new Set(repos.map(repo => process.platform === 'win32' ? repo.path.toLowerCase() : repo.path)).size !== repos.length) {
        fail('ERR_TUI_INDEXER_MEMBERSHIP', 'Repeated repository identities are not admitted.');
      }
      const queue = directory(config.queueDir ? path.resolve(config.queueDir) : path.join(getCacheRoot(), 'service/queue'));
      const authority = { configPath, configSha256: read.hash, queue, repos,
        workspace: workspace.repos.map(repo => ({ root: repo.repoRootCanonical, enabled: repo.enabled })) };
      return { config, authority, identity: digest(authority) };
    };
    const prepared = capture();
    const command = values.command || 'status';
    const review = { command, queue: prepared.authority.queue.path, queueName: 'index',
      configPath, configSha256: prepared.authority.configSha256, authorityIdentity: prepared.identity,
      repositories: prepared.authority.repos.map(repo => repo.path),
      concurrency: values.concurrency ?? 1, watch: command === 'work' && values.watch === true,
      effect: command === 'work' ? 'Claim ordinary index jobs for exactly these repositories; renew and settle their canonical leases. Writes indexes, queue state and producer logs.'
        : 'Observe the existing index queue and global shutdown state; do not claim or mutate jobs.',
      exclusions: ['other repository jobs', 'custom argv jobs', 'embedding queues', 'sync/clone', 'enqueue', 'global shutdown/resume', 'global stale-job recovery'],
      cancellation: 'Stops this native worker from claiming and aborts only its active claimed executions; waits for canonical settlement. Other workers retain their state.' };
    const execute = async ({ signal: jobSignal, env: launchEnv, onActivity }) => {
      if (capture().identity !== prepared.identity) fail('ERR_TUI_INDEXER_STALE', 'Indexer configuration or membership changed after preview.');
      throwIfAborted(jobSignal);
      const queueDir = prepared.authority.queue.path;
      if (command === 'status') return { exitCode: 0, signal: null,
        stdout: JSON.stringify({ ...review, summary: await queueSummary(queueDir, 'index'),
          shutdown: await loadServiceShutdownState(queueDir, 'index'), mutationPerformed: false }) };
      if (active.size >= 2 || [...active.values()].some(entry => entry.scopeId === scope.id)) {
        fail('ERR_TUI_INDEXER_ADMISSION', 'This session already owns the selected indexer or reached its two-worker bound.');
      }
      const controller = new AbortController();
      const combined = AbortSignal.any([jobSignal, controller.signal]);
      let settled;
      const settlement = new Promise(resolve => { settled = resolve; });
      const entry = { scopeId: scope.id, controller, settlement, worker: null };
      active.set(controller, entry);
      let authorityError = null, metrics = null;
      const { config } = prepared;
      try {
        const completion = createJobCompletion({ queueDir, resolvedQueueName: 'index',
          queueMaxRetries: config.queue?.maxRetries ?? null, completeJob, quarantineJob });
        const runtime = createServiceRuntimeEnvResolver({ baseEnv: launchEnv || env });
        const executor = createExecutor({ isEmbeddingsQueue: false, serviceExecutionMode: 'subprocess',
          daemonWorkerConfig: {}, resolvedQueueName: 'index', embeddingExtraEnv: {},
          resolveRepoRuntimeEnv: runtime.resolveRepoRuntimeEnv, toolRoot,
          completeNonRetriableFailure: completion.completeNonRetriableFailure });
        const checkAuthority = () => {
          if (capture().identity !== prepared.identity) fail('ERR_TUI_INDEXER_STALE', 'Indexer authority changed while running.');
        };
        const worker = createQueueWorker({ queueDir, resolvedQueueName: 'index',
          admissionPolicy: resolveQueueAdmissionPolicy({ queueName: 'index', queueConfig: config.queue, workerConfig: config.worker }),
          staleQueueMaxRetries: config.queue?.maxRetries ?? 2,
          monitorBuildProgress: false, startBuildProgressMonitor: () => async () => {},
          touchJobHeartbeat, ensureQueueDir,
          // Recovery of unrelated abandoned claims belongs to the service's
          // existing recovery owner, not this scoped native attachment.
          requeueStaleJobs: async () => {},
          claimNextJob: async (dir, queueName, options) => {
            checkAuthority();
            if (combined.aborted) return null;
            return claimNextJob(dir, queueName, { ...options, admitJob: job => {
              checkAuthority();
              return typeof job.repo === 'string' && path.isAbsolute(job.repo)
              && prepared.authority.repos.some(repo => sameIdentityPath(repo.path, job.repo))
              && ['all', 'both', ...PRIMARY_INDEX_MODES].includes(job.mode || 'both')
              && (!job.stage || normalizeIndexBuildStage(job.stage) === job.stage)
              && (!job.args || Array.isArray(job.args) && job.args.length === 0)
              && (!job.repoRoot || sameIdentityPath(job.repoRoot, job.repo));
            } });
          },
          executeClaimedJob: input => { checkAuthority(); return executor.executeClaimedJob(input); },
          buildDefaultRunResult: executor.buildDefaultRunResult,
          finalizeJobRun: completion.finalizeJobRun,
          printPayload: payload => { metrics = payload.metrics; },
          queueSummary: () => queueSummary(queueDir, 'index'),
          loadShutdownState: async () => {
            try { checkAuthority(); } catch (error) { authorityError ||= error; return localCancel(); }
            return combined.aborted ? localCancel() : loadServiceShutdownState(queueDir, 'index');
          },
          // Deadline escalation is also local. Never write a global shutdown
          // request or replace another worker's singleton control telemetry.
          requestShutdownState: async () => localCancel(),
          updateShutdownWorkerState: async patch => {
            entry.worker = { ownerId: patch.ownerId, status: patch.status, activeJobs: patch.activeJobs };
            onActivity({ phase: 'indexer-worker', stage: patch.status, current: patch.activeJobs.length,
              unit: 'owned active jobs', message: 'Canonical queue lease owner observed.' });
          },
          completeShutdownState: async () => null,
          resolveLeasePolicy: ({ job, queueName }) => resolveQueueLeasePolicy({ job, queueName }),
          shutdownPollIntervalMs: 250 });
        await worker.runWorkLoop({ requestedConcurrency: values.concurrency ?? 1,
          intervalMs: values.interval ?? 1000, watch: values.watch === true, serviceExecutionMode: 'subprocess' });
        if (authorityError) throw authorityError;
        return { exitCode: combined.aborted ? 130 : metrics?.failed ? 1 : 0, signal: null,
          stdout: JSON.stringify({ ...review, stopped: true, metrics, cancellationSettled: combined.aborted,
            processSuccessIsPublishedIndexReadiness: false }) };
      } finally { active.delete(controller); settled(); }
    };
    return { review, execute };
  };
  return { prepare,
    status: scopeId => [...active.values()].filter(entry => entry.scopeId === scopeId).map(entry => entry.worker),
    dispose: async () => {
      const owned = [...active.values()];
      for (const entry of owned) entry.controller.abort();
      await Promise.all(owned.map(entry => entry.settlement));
    } };
};
