import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { parseBuildArgs } from '../../../src/index/build/args.js';
import { buildIndex } from '../../../src/integrations/core/index.js';
import {
  applyObservabilityContextEnv,
  buildChildObservability
} from '../../../src/shared/observability.js';
import { collectEmbeddingReplayState, repairEmbeddingReplayState } from '../embedding-replay.js';
import { buildEmbeddingsArgs, normalizeEmbeddingJob } from '../indexer-service-helpers.js';
import { runLoggedSubprocess } from '../subprocess-log.js';

/**
 * Build the default run result shape used when execution fails unexpectedly.
 *
 * @returns {{exitCode:number,signal:null,executionMode:'subprocess',executionClass:'subprocess-isolated',daemon:null,cancelled:boolean,shutdownMode:string|null,governance:object,observability:null}}
 */
const buildDefaultRunResult = () => ({
  exitCode: 1,
  signal: null,
  executionMode: 'subprocess',
  executionClass: 'subprocess-isolated',
  daemon: null,
  cancelled: false,
  shutdownMode: null,
  governance: {
    policy: 'subprocess',
    decision: 'subprocess',
    sessionKey: null,
    sessionEpoch: 0,
    sessionJobCount: 0,
    recycleCount: 0,
    subprocessCooldownRemaining: 0
  },
  observability: null
});

const toPositiveInt = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.floor(numeric));
};

const toNonNegativeInt = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(numeric));
};

/**
 * Create queue job executors bound to one service runtime context.
 *
 * @param {{
 *   isEmbeddingsQueue:boolean,
 *   serviceExecutionMode:'daemon'|'subprocess',
 *   daemonWorkerConfig:object,
 *   resolvedQueueName:string|null,
 *   embeddingExtraEnv:Record<string,string>,
 *   resolveRepoRuntimeEnv:(repoPath:string,extraEnv?:Record<string,string>)=>Record<string,string>,
 *   toolRoot:string,
 *   completeNonRetriableFailure:(job:{id:string},error:string)=>Promise<void>,
 *   runBuildIndexSubprocessImpl?:(repoPath:string,mode:string|null,stage:string|null,extraArgs?:string[]|null,logPath?:string|null,abortSignal?:AbortSignal|null,observability?:object|null)=>Promise<{exitCode:number,signal:string|null,cancelled:boolean,errorCode:string|null,errorMessage:string|null}>,
 *   runBuildIndexDaemonImpl?:(repoPath:string,mode:string|null,stage:string|null,extraArgs?:string[]|null,logPath?:string|null,daemonOptions?:object,abortSignal?:AbortSignal|null,observability?:object|null)=>Promise<{exitCode:number,signal:null,executionMode:'daemon',daemon:object,cancelled:boolean,shutdownMode:string|null}>
 * }} input
 * @returns {{
 *   buildDefaultRunResult:()=>{exitCode:number,signal:null,executionMode:'subprocess',executionClass:'subprocess-isolated',daemon:null},
 *   executeClaimedJob:(input:{job:object,jobLifecycle:object,logPath:string,abortSignal?:AbortSignal|null})=>Promise<{handled:boolean,runResult?:{exitCode:number,signal:string|null,executionMode:string,executionClass:string,daemon:object|null,cancelled:boolean,shutdownMode:string|null}}>
 * }}
 */
export const createJobExecutor = ({
  isEmbeddingsQueue,
  serviceExecutionMode,
  daemonWorkerConfig,
  resolvedQueueName,
  embeddingExtraEnv,
  resolveRepoRuntimeEnv,
  toolRoot,
  completeNonRetriableFailure,
  runBuildIndexSubprocessImpl = null,
  runBuildIndexDaemonImpl = null
}) => {
  const daemonGovernanceConfig = (() => {
    const raw = daemonWorkerConfig?.governance && typeof daemonWorkerConfig.governance === 'object'
      ? daemonWorkerConfig.governance
      : {};
    return {
      executionClass: serviceExecutionMode === 'daemon' ? 'daemon-governed' : 'subprocess-isolated',
      maxConsecutiveFailures: toPositiveInt(raw.maxConsecutiveFailures ?? raw.maxErrorsBeforeFallback, 2),
      maxJobsPerSession: toPositiveInt(raw.maxJobsPerSession ?? raw.maxJobsBeforeRecycle, 25),
      subprocessCooldownJobs: toNonNegativeInt(raw.subprocessCooldownJobs ?? raw.fallbackSubprocessJobs, 1),
      sessionNamespace: typeof daemonWorkerConfig?.sessionNamespace === 'string' && daemonWorkerConfig.sessionNamespace.trim()
        ? daemonWorkerConfig.sessionNamespace.trim()
        : null,
      deterministic: daemonWorkerConfig?.deterministic !== false
    };
  })();
  const daemonGovernanceState = new Map();
  /**
   * Execute a Node subprocess and route output into the shared log helper.
   *
   * @param {string[]} args
   * @param {Record<string, string>} [extraEnv={}]
   * @param {string|null} [logPath=null]
   * @returns {Promise<{exitCode:number,signal:string|null,cancelled:boolean,errorCode:string|null,errorMessage:string|null}>}
   */
  const spawnWithLog = async (args, extraEnv = {}, logPath = null, abortSignal = null) => {
    const result = await runLoggedSubprocess({
      command: process.execPath,
      args,
      env: process.env,
      signal: abortSignal,
      extraEnv,
      logPath,
      onWriteError: (err) => {
        console.error(`[indexer] failed writing subprocess log (${logPath}): ${err?.message || err}`);
      }
    });
    if (result.errorMessage) {
      const reason = result.timedOut
        ? `timed out after ${result.durationMs ?? 'unknown'}ms`
        : result.errorMessage;
      console.error(`[indexer] subprocess failed: ${reason}`);
    } else if (typeof result.signal === 'string' && result.signal.trim().length > 0) {
      console.error(`[indexer] subprocess terminated via signal ${result.signal}.`);
    }
    return {
      exitCode: Number.isFinite(result.exitCode) ? result.exitCode : 1,
      signal: typeof result.signal === 'string' && result.signal.trim().length > 0
        ? result.signal.trim()
        : null,
      cancelled: result.cancelled === true,
      errorCode: result.errorCode || null,
      errorMessage: result.errorMessage || null
    };
  };

  /**
   * Run `build_index.js` in subprocess mode with either explicit argv passthrough
   * or reconstructed `--repo/--mode/--stage` arguments.
   *
   * @param {string} repoPath
   * @param {string|null} mode
   * @param {string|null} stage
   * @param {string[]|null} [extraArgs]
   * @param {string|null} [logPath]
   * @returns {Promise<{exitCode:number,signal:string|null,cancelled:boolean,errorCode:string|null,errorMessage:string|null}>}
   */
  const runBuildIndexSubprocess = (
    repoPath,
    mode,
    stage,
    extraArgs = null,
    logPath = null,
    abortSignal = null,
    observability = null
  ) => {
    const buildPath = path.join(toolRoot, 'build_index.js');
    const args = [buildPath];
    if (Array.isArray(extraArgs) && extraArgs.length) {
      args.push(...extraArgs);
    } else {
      args.push('--repo', repoPath);
      if (mode && mode !== 'both') args.push('--mode', mode);
      if (stage) args.push('--stage', stage);
    }
    const runtimeEnv = applyObservabilityContextEnv(
      resolveRepoRuntimeEnv(repoPath),
      observability
    );
    return spawnWithLog(args, runtimeEnv, logPath, abortSignal);
  };

  const callRunBuildIndexSubprocess = (
    repoPath,
    mode,
    stage,
    extraArgs = null,
    logPath = null,
    abortSignal = null,
    observability = null
  ) => (
    typeof runBuildIndexSubprocessImpl === 'function'
      ? runBuildIndexSubprocessImpl(repoPath, mode, stage, extraArgs, logPath, abortSignal, observability)
      : runBuildIndexSubprocess(repoPath, mode, stage, extraArgs, logPath, abortSignal, observability)
  );

  /**
   * Normalize arbitrary values for use inside daemon session key segments.
   *
   * @param {unknown} value
   * @param {string} [fallback='default']
   * @returns {string}
   */
  const toSafeSegment = (value, fallback = 'default') => {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    return trimmed.replace(/[^a-zA-Z0-9._:-]+/g, '_');
  };

  /**
   * Build a deterministic daemon session key for one repo + queue namespace.
   *
   * Repo path is canonicalized and hashed so keys stay short and safe for
   * logging/metrics tags while remaining stable across runs.
   *
   * @param {{repoPath?:string,queueName?:string,namespace?:string}} [input]
   * @returns {string}
   */
  const buildDaemonSessionKey = ({
    repoPath,
    queueName: daemonQueueName = 'index',
    namespace = null
  } = {}) => {
    const resolvedRepo = path.resolve(repoPath || process.cwd());
    const canonicalRepo = process.platform === 'win32'
      ? resolvedRepo.toLowerCase()
      : resolvedRepo;
    const digest = crypto.createHash('sha1').update(canonicalRepo).digest('hex').slice(0, 12);
    const queueSegment = toSafeSegment(daemonQueueName, 'index');
    const namespaceSegment = toSafeSegment(namespace || 'service-indexer', 'service-indexer');
    return `${namespaceSegment}:${queueSegment}:${digest}`;
  };

  const buildDaemonSessionNamespace = (namespace = null, sessionEpoch = 0) => {
    const segments = [];
    if (typeof namespace === 'string' && namespace.trim()) {
      segments.push(namespace.trim());
    }
    segments.push(`epoch-${Math.max(0, Math.trunc(Number(sessionEpoch) || 0))}`);
    return segments.join(':');
  };

  const resolveDaemonGovernanceState = (repoPath) => {
    const sessionScopeKey = buildDaemonSessionKey({
      repoPath,
      queueName: resolvedQueueName || 'index',
      namespace: daemonGovernanceConfig.sessionNamespace
    });
    if (!daemonGovernanceState.has(sessionScopeKey)) {
      daemonGovernanceState.set(sessionScopeKey, {
        sessionScopeKey,
        sessionEpoch: 0,
        sessionJobCount: 0,
        consecutiveFailures: 0,
        subprocessCooldownRemaining: 0,
        recycleCount: 0,
        lastSessionKey: null,
        lastDecision: null,
        lastReason: null
      });
    }
    return daemonGovernanceState.get(sessionScopeKey);
  };

  /**
   * Append one line to daemon execution logs, creating parent directories lazily.
   *
   * @param {string|null} logPath
   * @param {string} line
   * @returns {Promise<void>}
   */
  const appendDaemonLogLine = async (logPath, line) => {
    if (!logPath || !line) return;
    try {
      await fsPromises.mkdir(path.dirname(logPath), { recursive: true });
      await fsPromises.appendFile(logPath, `${line}\n`);
    } catch (err) {
      console.error(`[indexer] failed writing daemon log (${logPath}): ${err?.message || err}`);
    }
  };

  /**
   * Resolve build-index argv for daemon or subprocess execution.
   *
   * @param {string} repoPath
   * @param {string|null} mode
   * @param {string|null} stage
   * @param {string[]|null} [extraArgs]
   * @returns {string[]}
   */
  const resolveBuildIndexArgs = (repoPath, mode, stage, extraArgs = null) => {
    if (Array.isArray(extraArgs) && extraArgs.length) return extraArgs.slice();
    const args = ['--repo', repoPath];
    if (mode && mode !== 'both') args.push('--mode', mode);
    if (stage) args.push('--stage', stage);
    return args;
  };

  /**
   * Remove CLI parser internals before forwarding args into `buildIndex`.
   *
   * @param {object} argvValue
   * @returns {object}
   */
  const sanitizeBuildArgv = (argvValue) => {
    const next = {};
    for (const [key, value] of Object.entries(argvValue || {})) {
      if (key === '_' || key === '$0' || key === 'help' || key === 'h') continue;
      next[key] = value;
    }
    return next;
  };

  /**
   * Execute build-index request in daemon mode and return normalized result.
   *
   * @param {string} repoPath
   * @param {string|null} mode
   * @param {string|null} stage
   * @param {string[]|null} [extraArgs]
   * @param {string|null} [logPath]
   * @param {object} [daemonOptions]
   * @returns {Promise<{exitCode:number,signal:null,executionMode:'daemon',daemon:object,cancelled:boolean,shutdownMode:string|null}>}
   */
  const runBuildIndexDaemon = async (
    repoPath,
    mode,
    stage,
    extraArgs = null,
    logPath = null,
    daemonOptions = {},
    abortSignal = null,
    observability = null
  ) => {
    const rawArgs = resolveBuildIndexArgs(repoPath, mode, stage, extraArgs);
    const daemonDeterministic = daemonOptions?.deterministic !== false;
    const daemonHealth = daemonOptions?.health && typeof daemonOptions.health === 'object'
      ? daemonOptions.health
      : null;
    const daemonSessionKey = buildDaemonSessionKey({
      repoPath,
      queueName: daemonOptions?.queueName || 'index',
      namespace: daemonOptions?.sessionNamespace || null
    });
    const startedAt = Date.now();
    await appendDaemonLogLine(
      logPath,
      `[daemon] started ${new Date(startedAt).toISOString()} sessionKey=${daemonSessionKey} args=${JSON.stringify(rawArgs)}`
    );
    try {
      const { argv: parsedArgv } = parseBuildArgs(rawArgs);
      const buildArgv = sanitizeBuildArgv(parsedArgv);
      const resolvedRepo = buildArgv.repo || repoPath;
      const buildResult = await buildIndex(resolvedRepo, {
        ...buildArgv,
        rawArgv: rawArgs,
        abortSignal,
        daemonEnabled: true,
        daemonDeterministic,
        daemonSessionKey,
        daemonHealth,
        observability
      });
      const durationMs = Math.max(0, Date.now() - startedAt);
      await appendDaemonLogLine(logPath, `[daemon] completed durationMs=${durationMs}`);
      return {
        exitCode: 0,
        signal: null,
        executionMode: 'daemon',
        cancelled: false,
        shutdownMode: null,
        observability: buildResult?.observability || observability || null,
        daemon: {
          sessionKey: daemonSessionKey,
          deterministic: daemonDeterministic,
          durationMs
        }
      };
    } catch (err) {
      const durationMs = Math.max(0, Date.now() - startedAt);
      const message = err?.message || String(err);
      const cancelled = err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
      await appendDaemonLogLine(logPath, `[daemon] failed durationMs=${durationMs} error=${message}`);
      console.error(`[indexer] daemon build failed: ${message}`);
      return {
        exitCode: cancelled ? 130 : 1,
        signal: null,
        executionMode: 'daemon',
        cancelled,
        shutdownMode: cancelled ? 'force-stop' : null,
        observability: observability || null,
        daemon: {
          sessionKey: daemonSessionKey,
          deterministic: daemonDeterministic,
          durationMs,
          error: message
        }
      };
    }
  };

  const callRunBuildIndexDaemon = async (
    repoPath,
    mode,
    stage,
    extraArgs = null,
    logPath = null,
    daemonOptions = {},
    abortSignal = null,
    observability = null
  ) => (
    typeof runBuildIndexDaemonImpl === 'function'
      ? await runBuildIndexDaemonImpl(
        repoPath,
        mode,
        stage,
        extraArgs,
        logPath,
        daemonOptions,
        abortSignal,
        observability
      )
      : await runBuildIndexDaemon(
        repoPath,
        mode,
        stage,
        extraArgs,
        logPath,
        daemonOptions,
        abortSignal,
        observability
      )
  );

  /**
   * Run embeddings build worker for one repo/build root pair.
   *
   * @param {string} repoPath
   * @param {string|null} mode
   * @param {string} indexRoot
   * @param {Record<string, string>} [extraEnv={}]
   * @param {string|null} [logPath=null]
   * @returns {Promise<{exitCode:number,signal:string|null,cancelled:boolean,errorCode:string|null,errorMessage:string|null}>}
   */
  const runBuildEmbeddings = (
    repoPath,
    mode,
    indexRoot,
    extraEnv = {},
    logPath = null,
    abortSignal = null
  ) => {
    const buildPath = path.join(toolRoot, 'tools', 'build', 'embeddings.js');
    const args = buildEmbeddingsArgs({ buildPath, repoPath, mode, indexRoot });
    const runtimeEnv = resolveRepoRuntimeEnv(repoPath, extraEnv);
    return spawnWithLog(args, runtimeEnv, logPath, abortSignal);
  };

  /**
   * Execute one embeddings queue job.
   *
   * @param {{job:object,jobLifecycle:object,logPath:string,abortSignal?:AbortSignal|null}} input
   * @returns {Promise<{handled:boolean,runResult?:{exitCode:number,signal:string|null,executionMode:string,daemon:object|null,cancelled:boolean,shutdownMode:string|null}}>}
   */
  const executeEmbeddingJob = async ({ job, jobLifecycle, logPath, abortSignal = null }) => {
    const normalized = normalizeEmbeddingJob(job);
    const repoPath = normalized.repoRoot || job.repo;
    if (job.repoRoot && job.repo && path.resolve(job.repoRoot) !== path.resolve(job.repo)) {
      console.error(`[indexer] embedding job ${job.id} repoRoot mismatch (repo=${job.repo}, repoRoot=${job.repoRoot}); using repoRoot.`);
    }
    if (!repoPath || typeof repoPath !== 'string' || repoPath.trim().length === 0) {
      await completeNonRetriableFailure(job, 'missing repo path for embedding job');
      return { handled: true };
    }
    if (!normalized.buildRoot) {
      await completeNonRetriableFailure(job, 'missing buildRoot for embedding job');
      return { handled: true };
    }
    if (!fs.existsSync(normalized.buildRoot)) {
      await completeNonRetriableFailure(job, `embedding buildRoot missing: ${normalized.buildRoot}`);
      return { handled: true };
    }
    if (normalized.formatVersion && normalized.formatVersion < 2) {
      console.error(`[indexer] embedding job ${job.id} uses legacy payload; upgrading for processing.`);
    }
    if (normalized.indexDirUnderBuildRoot === false) {
      console.error(`[indexer] embedding job ${job.id} indexDir not under buildRoot; continuing with buildRoot only.`);
    }
    const replayRepair = await repairEmbeddingReplayState(job);
    job.replayState = replayRepair.after;
    const subprocessResult = await jobLifecycle.registerPromise(
      runBuildEmbeddings(
        repoPath,
        job.mode,
        normalized.buildRoot,
        embeddingExtraEnv,
        logPath,
        abortSignal
      ),
      { label: 'indexer-service-run-embeddings' }
    );
    return {
      handled: false,
      runResult: {
        exitCode: subprocessResult.cancelled ? 130 : subprocessResult.exitCode,
        signal: subprocessResult.signal,
        executionMode: 'subprocess',
        executionClass: 'subprocess-isolated',
        daemon: null,
        cancelled: subprocessResult.cancelled === true,
        shutdownMode: subprocessResult.cancelled ? 'force-stop' : null,
        governance: {
          policy: 'subprocess',
          decision: 'subprocess',
          sessionKey: null,
          sessionEpoch: 0,
          recycleCount: 0,
          subprocessCooldownRemaining: 0
        },
        replay: {
          version: 1,
          repair: replayRepair,
          current: await collectEmbeddingReplayState(job)
        }
      }
    };
  };

  /**
   * Execute one index queue job in daemon/subprocess mode.
   *
   * @param {{job:object,jobLifecycle:object,logPath:string,abortSignal?:AbortSignal|null}} input
   * @returns {Promise<{handled:boolean,runResult:{exitCode:number,signal:string|null,executionMode:string,daemon:object|null,cancelled:boolean,shutdownMode:string|null}}>}
   */
  const executeIndexJob = async ({ job, jobLifecycle, logPath, abortSignal = null }) => {
    const jobObservability = buildChildObservability(job?.observability || null, {
      surface: 'build',
      operation: 'build_index',
      phase: job?.stage || null,
      context: {
        queueName: resolvedQueueName || 'index',
        jobId: job?.id || null,
        repoRoot: job?.repo || null
      }
    });
    if (serviceExecutionMode === 'daemon') {
      const governanceState = resolveDaemonGovernanceState(job.repo);
      const daemonSessionNamespace = buildDaemonSessionNamespace(
        daemonGovernanceConfig.sessionNamespace,
        governanceState.sessionEpoch
      );
      const plannedSessionKey = buildDaemonSessionKey({
        repoPath: job.repo,
        queueName: resolvedQueueName || 'index',
        namespace: daemonSessionNamespace
      });
      if (governanceState.subprocessCooldownRemaining > 0) {
        const cooldownBeforeJob = governanceState.subprocessCooldownRemaining;
        const subprocessResult = await jobLifecycle.registerPromise(
          callRunBuildIndexSubprocess(job.repo, job.mode, job.stage, job.args, logPath, abortSignal, jobObservability),
          { label: 'indexer-service-run-index-subprocess-fallback' }
        );
        governanceState.subprocessCooldownRemaining = Math.max(0, governanceState.subprocessCooldownRemaining - 1);
        governanceState.lastSessionKey = plannedSessionKey;
        governanceState.lastDecision = 'subprocess-fallback';
        governanceState.lastReason = 'daemon-failure-burst';
        if ((subprocessResult.cancelled ? 130 : subprocessResult.exitCode) === 0 && !subprocessResult.signal) {
          governanceState.consecutiveFailures = 0;
        }
        return {
          handled: false,
          runResult: {
            exitCode: subprocessResult.cancelled ? 130 : subprocessResult.exitCode,
            signal: subprocessResult.signal,
            executionMode: 'subprocess',
            executionClass: daemonGovernanceConfig.executionClass,
            daemon: {
              sessionKey: plannedSessionKey,
              deterministic: daemonGovernanceConfig.deterministic,
              sessionEpoch: governanceState.sessionEpoch,
              recycleCount: governanceState.recycleCount,
              fallback: true
            },
            cancelled: subprocessResult.cancelled === true,
            shutdownMode: subprocessResult.cancelled ? 'force-stop' : null,
            governance: {
              policy: 'daemon',
              decision: 'subprocess-fallback',
              reason: 'daemon-failure-burst',
              sessionKey: plannedSessionKey,
              sessionEpoch: governanceState.sessionEpoch,
              sessionJobCount: governanceState.sessionJobCount,
              recycleCount: governanceState.recycleCount,
              subprocessCooldownRemaining: governanceState.subprocessCooldownRemaining,
              cooldownBeforeJob
            },
            observability: jobObservability
          }
        };
      }
      const runResult = await jobLifecycle.registerPromise(
        callRunBuildIndexDaemon(
          job.repo,
          job.mode,
          job.stage,
          job.args,
          logPath,
          {
            queueName: resolvedQueueName,
            deterministic: daemonWorkerConfig.deterministic !== false,
            sessionNamespace: daemonSessionNamespace,
            health: daemonWorkerConfig.health || null
          },
          abortSignal,
          jobObservability
        ),
        { label: 'indexer-service-run-index-daemon' }
      );
      const daemonFailed = runResult.cancelled !== true && (
        Number(runResult.exitCode) !== 0
        || (typeof runResult.signal === 'string' && runResult.signal.trim().length > 0)
      );
      if (!runResult.cancelled) {
        governanceState.sessionJobCount += 1;
      }
      let recycleRequested = false;
      let recycleReason = null;
      if (daemonFailed) {
        governanceState.consecutiveFailures += 1;
        if (governanceState.consecutiveFailures >= daemonGovernanceConfig.maxConsecutiveFailures) {
          governanceState.sessionEpoch += 1;
          governanceState.consecutiveFailures = 0;
          governanceState.recycleCount += 1;
          governanceState.subprocessCooldownRemaining = daemonGovernanceConfig.subprocessCooldownJobs;
          recycleRequested = true;
          recycleReason = 'daemon-failure-burst';
        }
      } else if (!runResult.cancelled) {
        governanceState.consecutiveFailures = 0;
      }
      if (!recycleRequested && !runResult.cancelled
        && governanceState.sessionJobCount >= daemonGovernanceConfig.maxJobsPerSession) {
        governanceState.sessionEpoch += 1;
        governanceState.sessionJobCount = 0;
        governanceState.recycleCount += 1;
        recycleRequested = true;
        recycleReason = 'daemon-session-job-budget';
      }
      if (recycleRequested) {
        governanceState.sessionJobCount = 0;
      }
      governanceState.lastSessionKey = runResult?.daemon?.sessionKey || plannedSessionKey;
      governanceState.lastDecision = 'daemon';
      governanceState.lastReason = recycleReason;
      runResult.executionClass = daemonGovernanceConfig.executionClass;
      runResult.governance = {
        policy: 'daemon',
        decision: 'daemon',
        reason: recycleReason,
        sessionKey: runResult?.daemon?.sessionKey || plannedSessionKey,
        sessionEpoch: recycleRequested ? Math.max(0, governanceState.sessionEpoch - 1) : governanceState.sessionEpoch,
        sessionJobCount: recycleRequested
          ? daemonGovernanceConfig.maxJobsPerSession
          : governanceState.sessionJobCount,
        nextSessionJobCount: governanceState.sessionJobCount,
        nextSessionEpoch: governanceState.sessionEpoch,
        recycleCount: governanceState.recycleCount,
        recycleRequested,
        maxJobsPerSession: daemonGovernanceConfig.maxJobsPerSession,
        subprocessCooldownRemaining: governanceState.subprocessCooldownRemaining
      };
      if (runResult?.daemon && typeof runResult.daemon === 'object') {
        runResult.daemon = {
          ...runResult.daemon,
          sessionEpoch: recycleRequested ? Math.max(0, governanceState.sessionEpoch - 1) : governanceState.sessionEpoch,
          sessionJobCount: recycleRequested
            ? daemonGovernanceConfig.maxJobsPerSession
            : governanceState.sessionJobCount,
          recycleCount: governanceState.recycleCount,
          recycleRequested,
          recycleReason
        };
      }
      return { handled: false, runResult };
    }
    const subprocessResult = await jobLifecycle.registerPromise(
      callRunBuildIndexSubprocess(job.repo, job.mode, job.stage, job.args, logPath, abortSignal, jobObservability),
      { label: 'indexer-service-run-index-subprocess' }
    );
    return {
      handled: false,
      runResult: {
        exitCode: subprocessResult.cancelled ? 130 : subprocessResult.exitCode,
        signal: subprocessResult.signal,
        executionMode: 'subprocess',
        executionClass: 'subprocess-isolated',
        daemon: null,
        cancelled: subprocessResult.cancelled === true,
        shutdownMode: subprocessResult.cancelled ? 'force-stop' : null,
        governance: {
          policy: 'subprocess',
          decision: 'subprocess',
          sessionKey: null,
          sessionEpoch: 0,
          sessionJobCount: 0,
          recycleCount: 0,
          subprocessCooldownRemaining: 0
        },
        observability: jobObservability
      }
    };
  };

  /**
   * Route a claimed job to the appropriate executor.
   *
   * @param {{job:object,jobLifecycle:object,logPath:string,abortSignal?:AbortSignal|null}} input
   * @returns {Promise<{handled:boolean,runResult?:{exitCode:number,signal:string|null,executionMode:string,daemon:object|null,cancelled:boolean,shutdownMode:string|null}}>}
   */
  const executeClaimedJob = ({ job, jobLifecycle, logPath, abortSignal = null }) => (isEmbeddingsQueue
    ? executeEmbeddingJob({ job, jobLifecycle, logPath, abortSignal })
    : executeIndexJob({ job, jobLifecycle, logPath, abortSignal }));

  return {
    buildDefaultRunResult,
    executeClaimedJob
  };
};
