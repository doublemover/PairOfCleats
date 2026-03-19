import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { parseBuildArgs } from '../../../src/index/build/args.js';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { isAbsolutePathNative } from '../../../src/shared/files.js';
import { collectEmbeddingReplayState, repairEmbeddingReplayState } from '../embedding-replay.js';
import { buildEmbeddingsArgs, normalizeEmbeddingJob } from '../indexer-service-helpers.js';
import { runLoggedSubprocess } from '../subprocess-log.js';

/**
 * Build the default run result shape used when execution fails unexpectedly.
 *
 * @returns {{exitCode:number,signal:null,executionMode:'subprocess',daemon:null,cancelled:boolean,shutdownMode:string|null}}
 */
const buildDefaultRunResult = () => ({
  exitCode: 1,
  signal: null,
  executionMode: 'subprocess',
  daemon: null,
  cancelled: false,
  shutdownMode: null
});

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
 *   completeNonRetriableFailure:(job:{id:string},error:string)=>Promise<void>
 * }} input
 * @returns {{
 *   buildDefaultRunResult:()=>{exitCode:number,signal:null,executionMode:'subprocess',daemon:null},
 *   executeClaimedJob:(input:{job:object,jobLifecycle:object,logPath:string,abortSignal?:AbortSignal|null})=>Promise<{handled:boolean,runResult?:{exitCode:number,signal:string|null,executionMode:string,daemon:object|null,cancelled:boolean,shutdownMode:string|null}}>
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
  completeNonRetriableFailure
}) => {
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
    abortSignal = null
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
    const runtimeEnv = resolveRepoRuntimeEnv(repoPath);
    return spawnWithLog(args, runtimeEnv, logPath, abortSignal);
  };

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
    abortSignal = null
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
      await buildIndex(resolvedRepo, {
        ...buildArgv,
        rawArgv: rawArgs,
        abortSignal,
        daemonEnabled: true,
        daemonDeterministic,
        daemonSessionKey,
        daemonHealth
      });
      const durationMs = Math.max(0, Date.now() - startedAt);
      await appendDaemonLogLine(logPath, `[daemon] completed durationMs=${durationMs}`);
      return {
        exitCode: 0,
        signal: null,
        executionMode: 'daemon',
        cancelled: false,
        shutdownMode: null,
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
        daemon: {
          sessionKey: daemonSessionKey,
          deterministic: daemonDeterministic,
          durationMs,
          error: message
        }
      };
    }
  };

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
    if (normalized.indexDir) {
      const rel = path.relative(normalized.buildRoot, normalized.indexDir);
      if (rel.startsWith('..') || isAbsolutePathNative(rel)) {
        console.error(`[indexer] embedding job ${job.id} indexDir not under buildRoot; continuing with buildRoot only.`);
      }
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
        daemon: null,
        cancelled: subprocessResult.cancelled === true,
        shutdownMode: subprocessResult.cancelled ? 'force-stop' : null,
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
    if (serviceExecutionMode === 'daemon') {
      const runResult = await jobLifecycle.registerPromise(
        runBuildIndexDaemon(
          job.repo,
          job.mode,
          job.stage,
          job.args,
          logPath,
          {
            queueName: resolvedQueueName,
            deterministic: daemonWorkerConfig.deterministic !== false,
            sessionNamespace: daemonWorkerConfig.sessionNamespace || null,
            health: daemonWorkerConfig.health || null
          },
          abortSignal
        ),
        { label: 'indexer-service-run-index-daemon' }
      );
      return { handled: false, runResult };
    }
    const subprocessResult = await jobLifecycle.registerPromise(
      runBuildIndexSubprocess(job.repo, job.mode, job.stage, job.args, logPath, abortSignal),
      { label: 'indexer-service-run-index-subprocess' }
    );
    return {
      handled: false,
      runResult: {
        exitCode: subprocessResult.cancelled ? 130 : subprocessResult.exitCode,
        signal: subprocessResult.signal,
        executionMode: 'subprocess',
        daemon: null,
        cancelled: subprocessResult.cancelled === true,
        shutdownMode: subprocessResult.cancelled ? 'force-stop' : null
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
