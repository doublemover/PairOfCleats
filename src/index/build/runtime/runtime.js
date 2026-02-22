import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getCacheRuntimeConfig,
  getCodeDictionaryPaths,
  getDictionaryPaths,
  getDictConfig,
  getEffectiveConfigHash,
  getBuildsRoot,
  getCacheRoot,
  getRepoCacheRoot,
  getToolVersion,
  getToolingConfig,
  getTriageConfig,
  loadUserConfig,
  resolveIndexRoot
} from '../../../shared/dict-utils.js';
import { normalizeBundleFormat } from '../../../shared/bundle-io.js';
import { normalizeCommentConfig } from '../../comments.js';
import { normalizeSegmentsConfig } from '../../segments.js';
import { log } from '../../../shared/progress.js';
import { getEnvConfig, isTestingEnv } from '../../../shared/env.js';
import { isAbsolutePathNative } from '../../../shared/files.js';
import { resolveCacheFilesystemProfile } from '../../../shared/cache-roots.js';
import { buildAutoPolicy } from '../../../shared/auto-policy.js';
import { warmEmbeddingAdapter } from '../../../shared/embedding-adapter.js';
import { buildIgnoreMatcher } from '../ignore.js';
import { normalizePostingsConfig } from '../../../shared/postings-config.js';
import { createSharedDictionary, createSharedDictionaryView } from '../../../shared/dictionary.js';
import {
  coerceClampedFraction,
  coerceNonNegativeInt,
  coercePositiveInt
} from '../../../shared/number-coerce.js';
import { normalizeEmbeddingBatchMultipliers } from '../embedding-batch.js';
import { mergeConfig } from '../../../shared/config.js';
import { sha1, setXxhashBackend } from '../../../shared/hash.js';
import { getScmProvider, getScmProviderAndRoot, resolveScmConfig } from '../../scm/registry.js';
import { setScmRuntimeConfig } from '../../scm/runtime.js';
import { normalizeRiskConfig } from '../../risk.js';
import { normalizeRiskInterproceduralConfig } from '../../risk-interprocedural/config.js';
import { normalizeRecordsConfig } from '../records.js';
import { DEFAULT_CODE_DICT_LANGUAGES, normalizeCodeDictLanguages } from '../../../shared/code-dictionaries.js';
import { resolveRuntimeEnvelope } from '../../../shared/runtime-envelope.js';
import { buildContentConfigHash } from './hash.js';
import { normalizeStage, buildStageOverrides } from './stage.js';
import { configureRuntimeLogger } from './logging.js';
import { normalizeLimit, resolveFileCapsAndGuardrails } from './caps.js';
import {
  normalizeLanguageParserConfig,
  normalizeLanguageFlowConfig,
  normalizeDictSignaturePath
} from './normalize.js';
import { buildAnalysisPolicy } from './policy.js';
import {
  buildFileScanConfig,
  buildGeneratedIndexingPolicyConfig,
  buildShardConfig,
  formatBuildNonce,
  formatBuildTimestamp
} from './config.js';
import { resolveEmbeddingRuntime } from './embeddings.js';
import { createBuildScheduler } from '../../../shared/concurrency.js';
import { resolveSchedulerConfig } from './scheduler.js';
import { loadSchedulerAutoTuneProfile } from './scheduler-autotune-profile.js';
import { resolveTreeSitterRuntime, preloadTreeSitterRuntimeLanguages } from './tree-sitter.js';
import { resolveSubprocessFanoutPreset } from '../../../shared/subprocess.js';
import {
  acquireRuntimeDaemonSession,
  createRuntimeDaemonJobContext,
  getDaemonDictionaryCacheEntry,
  setDaemonDictionaryCacheEntry,
  getDaemonTreeSitterCacheEntry,
  setDaemonTreeSitterCacheEntry,
  hasDaemonEmbeddingWarmKey,
  addDaemonEmbeddingWarmKey
} from './daemon-session.js';
import { resolveLearnedAutoProfileSelection } from './learned-auto-profile.js';
import {
  createRuntimeQueues,
  resolveRuntimeMemoryPolicy,
  resolveWorkerPoolRuntimeConfig,
  createRuntimeWorkerPools
} from './workers.js';
import {
  assertKnownIndexProfileId,
  buildIndexProfileState
} from '../../../contracts/index-profile.js';

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const INDEX_OPTIMIZATION_PROFILE_IDS = Object.freeze(['default', 'throughput', 'memory-saver']);
const coerceOptionalNonNegativeInt = (value) => {
  if (value === null || value === undefined) return null;
  return coerceNonNegativeInt(value);
};

const normalizeOwnershipSegment = (value, fallback = 'unknown') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^a-zA-Z0-9._:-]+/g, '_');
};

const buildStage1SubprocessOwnershipPrefix = ({ buildId } = {}) => (
  `stage1:${normalizeOwnershipSegment(buildId, 'build')}`
);

export const normalizeIndexOptimizationProfile = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return INDEX_OPTIMIZATION_PROFILE_IDS.includes(normalized) ? normalized : 'default';
};

export const applyLearnedAutoProfileSelection = ({
  indexingConfig = {},
  learnedAutoProfile = null
} = {}) => {
  if (!isObject(indexingConfig)) return {};
  if (!isObject(learnedAutoProfile)) return indexingConfig;
  if (learnedAutoProfile.applied !== true) return indexingConfig;
  if (!isObject(learnedAutoProfile.overrides)) return indexingConfig;
  return mergeConfig(indexingConfig, learnedAutoProfile.overrides);
};

export const resolvePlatformRuntimePreset = ({
  platform = process.platform,
  filesystemProfile = 'unknown',
  cpuCount = 1,
  indexingConfig = {}
} = {}) => {
  const presetsConfig = indexingConfig?.platformPresets && typeof indexingConfig.platformPresets === 'object'
    ? indexingConfig.platformPresets
    : {};
  if (presetsConfig.enabled === false) {
    return {
      enabled: false,
      presetId: 'disabled',
      filesystemProfile,
      subprocessFanout: resolveSubprocessFanoutPreset({ platform, cpuCount, filesystemProfile }),
      overrides: null
    };
  }
  const artifactsConfig = indexingConfig?.artifacts && typeof indexingConfig.artifacts === 'object'
    ? indexingConfig.artifacts
    : {};
  const scmConfig = indexingConfig?.scm && typeof indexingConfig.scm === 'object'
    ? indexingConfig.scm
    : {};
  const subprocessFanout = resolveSubprocessFanoutPreset({ platform, cpuCount, filesystemProfile });
  const overrides = {};
  if (typeof artifactsConfig.writeFsStrategy !== 'string' || !artifactsConfig.writeFsStrategy.trim()) {
    overrides.artifacts = {
      writeFsStrategy: filesystemProfile === 'ntfs' ? 'ntfs' : 'generic'
    };
  }
  if (!Number.isFinite(Number(scmConfig.maxConcurrentProcesses)) || Number(scmConfig.maxConcurrentProcesses) <= 0) {
    overrides.scm = {
      maxConcurrentProcesses: subprocessFanout.maxParallelismHint
    };
  }
  if (platform === 'win32') {
    const schedulerConfig = indexingConfig?.scheduler && typeof indexingConfig.scheduler === 'object'
      ? indexingConfig.scheduler
      : {};
    if (!schedulerConfig?.writeBackpressure || typeof schedulerConfig.writeBackpressure !== 'object') {
      overrides.scheduler = {
        writeBackpressure: {
          pendingBytesThreshold: 384 * 1024 * 1024,
          oldestWaitMsThreshold: 12000
        }
      };
    }
  }
  return {
    enabled: true,
    presetId: `${platform}:${filesystemProfile}`,
    filesystemProfile,
    subprocessFanout,
    overrides: Object.keys(overrides).length ? overrides : null
  };
};

export const runStartupCalibrationProbe = async ({
  cacheRoot,
  enabled = true
} = {}) => {
  if (!enabled || !cacheRoot) {
    return {
      enabled: false,
      probeBytes: 0,
      writeReadMs: 0,
      cleanupMs: 0
    };
  }
  const probeDir = path.join(cacheRoot, 'runtime-calibration');
  const probePath = path.join(probeDir, `probe-${process.pid}.tmp`);
  const probeBytes = 8 * 1024;
  const payload = Buffer.alloc(probeBytes, 97);
  const writeReadStart = Date.now();
  try {
    await fs.mkdir(probeDir, { recursive: true });
    await fs.writeFile(probePath, payload);
    await fs.readFile(probePath);
  } catch (err) {
    return {
      enabled: true,
      probeBytes,
      writeReadMs: Math.max(0, Date.now() - writeReadStart),
      cleanupMs: 0,
      error: err?.message || String(err)
    };
  }
  const writeReadMs = Math.max(0, Date.now() - writeReadStart);
  const cleanupStart = Date.now();
  try {
    await fs.rm(probePath, { force: true });
  } catch {}
  return {
    enabled: true,
    probeBytes,
    writeReadMs,
    cleanupMs: Math.max(0, Date.now() - cleanupStart)
  };
};

const cloneSet = (source) => new Set(source instanceof Set ? source : []);

const cloneMapOfSets = (source) => {
  if (!(source instanceof Map)) return new Map();
  return new Map(
    Array.from(source.entries()).map(([key, value]) => [key, cloneSet(value)])
  );
};

const cloneDaemonDictionaryEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  return {
    dictWords: cloneSet(entry.dictWords),
    codeDictCommonWords: cloneSet(entry.codeDictCommonWords),
    codeDictWordsAll: cloneSet(entry.codeDictWordsAll),
    codeDictWordsByLanguage: cloneMapOfSets(entry.codeDictWordsByLanguage),
    dictSummary: entry.dictSummary && typeof entry.dictSummary === 'object'
      ? JSON.parse(JSON.stringify(entry.dictSummary))
      : null
  };
};

/**
 * Shared runtime telemetry collector for cross-stage in-flight gauges.
 *
 * @returns {{
 *   setInFlightBytes:(channel:string, input?:{bytes?:number,count?:number})=>void,
 *   clearInFlightBytes:(channel:string)=>void,
 *   readInFlightBytes:()=>{total:number,channels:Record<string,{bytes:number,count:number}>},
 *   recordDuration:(channel:string, durationMs:number)=>void,
 *   clearDurationHistogram:(channel:string)=>void,
 *   readDurationHistograms:()=>Record<string,{
 *     count:number,totalMs:number,minMs:number,maxMs:number,avgMs:number,
 *     bucketsMs:number[],counts:number[],overflow:number
 *   }>
 * }}
 */
const createRuntimeTelemetry = () => {
  const channels = new Map();
  const DEFAULT_DURATION_BUCKETS_MS = Object.freeze([50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000]);
  const durationHistograms = new Map();
  const setInFlightBytes = (channel, input = {}) => {
    if (!channel) return;
    const bytes = Number(input?.bytes);
    const count = Number(input?.count);
    channels.set(String(channel), {
      bytes: Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : 0,
      count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
    });
  };
  const clearInFlightBytes = (channel) => {
    if (!channel) return;
    channels.delete(String(channel));
  };
  const readInFlightBytes = () => {
    const out = {};
    let total = 0;
    for (const [name, value] of channels.entries()) {
      const bytes = Number(value?.bytes) || 0;
      const count = Number(value?.count) || 0;
      out[name] = { bytes, count };
      total += bytes;
    }
    return { total, channels: out };
  };
  const coerceDurationMs = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  const resolveHistogramState = (channel) => {
    const key = String(channel);
    const existing = durationHistograms.get(key);
    if (existing) return existing;
    const bucketsMs = DEFAULT_DURATION_BUCKETS_MS.slice();
    const state = {
      bucketsMs,
      counts: new Array(bucketsMs.length).fill(0),
      overflow: 0,
      count: 0,
      totalMs: 0,
      minMs: null,
      maxMs: 0
    };
    durationHistograms.set(key, state);
    return state;
  };
  const recordDuration = (channel, durationMs) => {
    if (!channel) return;
    const duration = coerceDurationMs(durationMs);
    const state = resolveHistogramState(channel);
    state.count += 1;
    state.totalMs += duration;
    state.minMs = state.minMs == null ? duration : Math.min(state.minMs, duration);
    state.maxMs = Math.max(state.maxMs, duration);
    let bucketIndex = -1;
    for (let i = 0; i < state.bucketsMs.length; i += 1) {
      if (duration <= state.bucketsMs[i]) {
        bucketIndex = i;
        break;
      }
    }
    if (bucketIndex >= 0) {
      state.counts[bucketIndex] += 1;
    } else {
      state.overflow += 1;
    }
  };
  const clearDurationHistogram = (channel) => {
    if (!channel) return;
    durationHistograms.delete(String(channel));
  };
  const readDurationHistograms = () => {
    const out = {};
    for (const [name, value] of durationHistograms.entries()) {
      const count = Number(value?.count) || 0;
      const totalMs = Number(value?.totalMs) || 0;
      const minMs = value?.minMs == null ? 0 : (Number(value.minMs) || 0);
      const maxMs = Number(value?.maxMs) || 0;
      const avgMs = count > 0 ? totalMs / count : 0;
      out[name] = {
        count,
        totalMs,
        minMs,
        maxMs,
        avgMs,
        bucketsMs: Array.isArray(value?.bucketsMs) ? value.bucketsMs.slice() : [],
        counts: Array.isArray(value?.counts) ? value.counts.slice() : [],
        overflow: Number(value?.overflow) || 0
      };
    }
    return out;
  };
  return {
    setInFlightBytes,
    clearInFlightBytes,
    readInFlightBytes,
    recordDuration,
    clearDurationHistogram,
    readDurationHistograms
  };
};

/**
 * Resolve stage1 queue controls from indexing configuration, coercing optional
 * numeric overrides into safe integer/fraction values.
 *
 * @param {object} [indexingConfig]
 * @returns {{tokenize:object,postings:object,ordered:object,watchdog:object}}
 */
const resolveStage1Queues = (indexingConfig = {}) => {
  const stage1 = indexingConfig?.stage1 && typeof indexingConfig.stage1 === 'object'
    ? indexingConfig.stage1
    : {};
  const tokenize = stage1?.tokenize && typeof stage1.tokenize === 'object'
    ? stage1.tokenize
    : {};
  const postings = stage1?.postings && typeof stage1.postings === 'object'
    ? stage1.postings
    : {};
  const ordered = stage1?.ordered && typeof stage1.ordered === 'object'
    ? stage1.ordered
    : {};
  const watchdog = stage1?.watchdog && typeof stage1.watchdog === 'object'
    ? stage1.watchdog
    : {};

  const tokenizeConcurrency = coercePositiveInt(tokenize.concurrency);
  const tokenizeMaxPending = coercePositiveInt(tokenize.maxPending);

  const postingsMaxPending = coercePositiveInt(
    postings.maxPending ?? postings.concurrency
  );
  const postingsMaxPendingRows = coercePositiveInt(postings.maxPendingRows);
  const postingsMaxPendingBytes = coercePositiveInt(postings.maxPendingBytes);
  const postingsMaxHeapFraction = coerceClampedFraction(postings.maxHeapFraction, {
    min: 0,
    max: 1,
    allowZero: false
  });
  const orderedMaxPending = coercePositiveInt(ordered.maxPending);
  const orderedBucketSize = coercePositiveInt(ordered.bucketSize);
  const orderedMaxPendingEmergencyFactor = Number(ordered.maxPendingEmergencyFactor);
  const watchdogSlowFileMs = coerceOptionalNonNegativeInt(
    watchdog.slowFileMs ?? stage1.fileWatchdogMs
  );
  const watchdogMaxSlowFileMs = coerceOptionalNonNegativeInt(
    watchdog.maxSlowFileMs ?? stage1.fileWatchdogMaxMs
  );
  const watchdogHardTimeoutMs = coerceOptionalNonNegativeInt(
    watchdog.hardTimeoutMs ?? stage1.fileWatchdogHardMs
  );
  const watchdogBytesPerStep = coercePositiveInt(watchdog.bytesPerStep);
  const watchdogLinesPerStep = coercePositiveInt(watchdog.linesPerStep);
  const watchdogStepMs = coercePositiveInt(watchdog.stepMs);
  const watchdogNearThresholdLowerFraction = coerceClampedFraction(
    watchdog.nearThresholdLowerFraction,
    { min: 0, max: 1, allowZero: false }
  );
  const watchdogNearThresholdUpperFraction = coerceClampedFraction(
    watchdog.nearThresholdUpperFraction,
    { min: 0, max: 1, allowZero: false }
  );
  const watchdogNearThresholdAlertFraction = coerceClampedFraction(
    watchdog.nearThresholdAlertFraction,
    { min: 0, max: 1, allowZero: false }
  );
  const watchdogNearThresholdMinSamples = coercePositiveInt(watchdog.nearThresholdMinSamples);

  return {
    tokenize: {
      concurrency: tokenizeConcurrency,
      maxPending: tokenizeMaxPending
    },
    postings: {
      maxPending: postingsMaxPending,
      maxPendingRows: postingsMaxPendingRows,
      maxPendingBytes: postingsMaxPendingBytes,
      maxHeapFraction: postingsMaxHeapFraction
    },
    ordered: {
      maxPending: orderedMaxPending,
      bucketSize: orderedBucketSize,
      maxPendingEmergencyFactor: Number.isFinite(orderedMaxPendingEmergencyFactor)
        && orderedMaxPendingEmergencyFactor > 1
        ? orderedMaxPendingEmergencyFactor
        : null
    },
    watchdog: {
      slowFileMs: watchdogSlowFileMs,
      maxSlowFileMs: watchdogMaxSlowFileMs,
      hardTimeoutMs: watchdogHardTimeoutMs,
      bytesPerStep: watchdogBytesPerStep,
      linesPerStep: watchdogLinesPerStep,
      stepMs: watchdogStepMs,
      nearThresholdLowerFraction: watchdogNearThresholdLowerFraction,
      nearThresholdUpperFraction: watchdogNearThresholdUpperFraction,
      nearThresholdAlertFraction: watchdogNearThresholdAlertFraction,
      nearThresholdMinSamples: watchdogNearThresholdMinSamples
    }
  };
};

/**
 * Create runtime configuration for build_index.
 * @param {{root:string,argv:object,rawArgv:string[]}} input
 * @returns {Promise<object>}
 */
export async function createBuildRuntime({ root, argv, rawArgv, policy, indexRoot: indexRootOverride = null } = {}) {
  const initStartedAt = Date.now();
  const logInit = (label, startedAt) => {
    const elapsed = Math.max(0, Date.now() - startedAt);
    log(`[init] ${label} (${elapsed}ms)`);
  };
  const timeInit = async (label, fn) => {
    const startedAt = Date.now();
    const result = await fn();
    logInit(label, startedAt);
    return result;
  };

  const userConfig = await timeInit('load config', () => loadUserConfig(root));
  const envConfig = getEnvConfig();
  const importGraphEnabled = envConfig.importGraph == null ? true : envConfig.importGraph;
  const rawIndexingConfig = userConfig.indexing || {};
  let indexingConfig = rawIndexingConfig;
  const qualityOverride = typeof argv.quality === 'string' ? argv.quality.trim().toLowerCase() : '';
  const policyConfig = qualityOverride ? { ...userConfig, quality: qualityOverride } : userConfig;
  const autoPolicy = policy
    ? policy
    : await timeInit('auto policy', () => buildAutoPolicy({ repoRoot: root, config: policyConfig }));
  if (policy) {
    log('[init] auto policy (provided)');
  }
  const policyConcurrency = autoPolicy?.indexing?.concurrency || null;
  const policyEmbeddings = autoPolicy?.indexing?.embeddings || null;
  const policyWorkerPool = autoPolicy?.runtime?.workerPool || null;
  const autoPolicyProfile = isObject(autoPolicy?.profile)
    ? autoPolicy.profile
    : { id: 'default', enabled: false };
  const policyHugeRepoProfile = isObject(autoPolicy?.indexing?.hugeRepoProfile)
    ? autoPolicy.indexing.hugeRepoProfile
    : null;
  const explicitHugeRepoProfile = isObject(indexingConfig?.hugeRepoProfile)
    ? indexingConfig.hugeRepoProfile
    : {};
  const hugeRepoProfileEnabled = typeof explicitHugeRepoProfile.enabled === 'boolean'
    ? explicitHugeRepoProfile.enabled
    : policyHugeRepoProfile?.enabled === true;
  if (hugeRepoProfileEnabled && isObject(policyHugeRepoProfile?.overrides)) {
    indexingConfig = mergeConfig(indexingConfig, policyHugeRepoProfile.overrides);
  }
  if (policyConcurrency) {
    indexingConfig = mergeConfig(indexingConfig, {
      concurrency: policyConcurrency.files,
      importConcurrency: policyConcurrency.imports,
      ioConcurrencyCap: policyConcurrency.io
    });
  }
  if (policyEmbeddings && typeof policyEmbeddings.enabled === 'boolean') {
    indexingConfig = mergeConfig(indexingConfig, {
      embeddings: { enabled: policyEmbeddings.enabled }
    });
  }
  if (policyWorkerPool) {
    indexingConfig = mergeConfig(indexingConfig, {
      workerPool: {
        enabled: policyWorkerPool.enabled !== false ? 'auto' : false,
        maxWorkers: policyWorkerPool.maxThreads
      }
    });
  }
  if (hugeRepoProfileEnabled) {
    indexingConfig = mergeConfig(indexingConfig, {
      hugeRepoProfile: {
        enabled: true,
        id: autoPolicyProfile.id || 'huge-repo'
      }
    });
  }
  const baseEmbeddingsConfig = indexingConfig.embeddings || {};
  const baseEmbeddingModeRaw = typeof baseEmbeddingsConfig.mode === 'string'
    ? baseEmbeddingsConfig.mode.trim().toLowerCase()
    : 'auto';
  const baseEmbeddingMode = ['auto', 'inline', 'service', 'stub', 'off'].includes(baseEmbeddingModeRaw)
    ? baseEmbeddingModeRaw
    : 'auto';
  const baseEmbeddingsPlanned = baseEmbeddingsConfig.enabled !== false && baseEmbeddingMode !== 'off';
  const requestedHashBackend = typeof indexingConfig?.hash?.backend === 'string'
    ? indexingConfig.hash.backend.trim().toLowerCase()
    : '';
  if (requestedHashBackend && !envConfig.xxhashBackend) {
    setXxhashBackend(requestedHashBackend);
  }
  const stage = normalizeStage(argv.stage || envConfig.stage);
  const twoStageConfig = indexingConfig.twoStage || {};
  const stageOverrides = buildStageOverrides(twoStageConfig, stage);
  if (stageOverrides) {
    indexingConfig = mergeConfig(indexingConfig, stageOverrides);
  }
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const cacheRootCandidate = (userConfig.cache && userConfig.cache.root) || getCacheRoot();
  const filesystemProfile = resolveCacheFilesystemProfile(cacheRootCandidate, process.platform);
  const platformRuntimePreset = resolvePlatformRuntimePreset({
    platform: process.platform,
    filesystemProfile,
    cpuCount: os.cpus().length,
    indexingConfig
  });
  if (platformRuntimePreset?.overrides) {
    indexingConfig = mergeConfig(indexingConfig, platformRuntimePreset.overrides);
  }
  const learnedAutoProfile = await timeInit('learned auto profile', () => resolveLearnedAutoProfileSelection({
    root,
    repoCacheRoot,
    indexingConfig,
    log
  }));
  indexingConfig = applyLearnedAutoProfileSelection({
    indexingConfig,
    learnedAutoProfile
  });
  const profileId = assertKnownIndexProfileId(indexingConfig.profile);
  const profile = buildIndexProfileState(profileId);
  const indexOptimizationProfile = normalizeIndexOptimizationProfile(
    indexingConfig.indexOptimizationProfile
  );
  indexingConfig = {
    ...indexingConfig,
    profile: profile.id,
    indexOptimizationProfile
  };
  const rawArgs = Array.isArray(rawArgv) ? rawArgv : [];
  const scmAnnotateOverride = rawArgs.includes('--scm-annotate')
    ? true
    : (rawArgs.includes('--no-scm-annotate') ? false : null);
  if (scmAnnotateOverride != null) {
    indexingConfig = mergeConfig(indexingConfig, {
      scm: { annotate: { enabled: scmAnnotateOverride } }
    });
  }
  const scmConfig = resolveScmConfig({
    indexingConfig,
    analysisPolicy: userConfig.analysisPolicy || null,
    benchRun: envConfig.benchRun === true
  });
  setScmRuntimeConfig(scmConfig);
  const cacheRoot = cacheRootCandidate;
  const cacheRootSource = userConfig.cache?.root
    ? 'config'
    : (envConfig.cacheRoot ? 'env' : 'default');
  log(`[init] cache root (${cacheRootSource}): ${path.resolve(cacheRoot)}`);
  log(`[init] repo cache root: ${path.resolve(repoCacheRoot)}`);
  if (platformRuntimePreset?.enabled !== false) {
    const fanoutHint = platformRuntimePreset?.subprocessFanout?.maxParallelismHint;
    const fanoutReason = platformRuntimePreset?.subprocessFanout?.reason || 'unknown';
    log(
      `[init] platform preset: ${platformRuntimePreset?.presetId || 'default'} ` +
      `(fs=${filesystemProfile}, subprocessFanout=${fanoutHint || 'n/a'}, reason=${fanoutReason}).`
    );
  }
  const startupCalibrationEnabled = indexingConfig?.platformPresets?.startupCalibration !== false;
  const startupCalibration = await timeInit('startup calibration', () => runStartupCalibrationProbe({
    cacheRoot,
    enabled: startupCalibrationEnabled
  }));
  if (startupCalibration?.enabled) {
    if (startupCalibration?.error) {
      log(`[init] startup calibration probe degraded: ${startupCalibration.error}`);
    } else {
      log(
        `[init] startup calibration: io=${startupCalibration.writeReadMs}ms ` +
        `(bytes=${startupCalibration.probeBytes}).`
      );
    }
  }
  const daemonConfig = indexingConfig?.daemon && typeof indexingConfig.daemon === 'object'
    ? indexingConfig.daemon
    : {};
  const daemonEnabledFromArg = argv.daemon === true || argv.daemonEnabled === true;
  const daemonSessionKeyFromArg = typeof argv.daemonSessionKey === 'string'
    ? argv.daemonSessionKey.trim()
    : '';
  const daemonDeterministicArg = typeof argv.daemonDeterministic === 'boolean'
    ? argv.daemonDeterministic
    : null;
  const daemonHealthArg = argv.daemonHealth && typeof argv.daemonHealth === 'object'
    ? argv.daemonHealth
    : null;
  const daemonEnabled = daemonEnabledFromArg
    || daemonConfig.enabled === true
    || process.env.PAIROFCLEATS_INDEX_DAEMON === '1';
  const daemonDeterministic = daemonDeterministicArg === null
    ? daemonConfig.deterministic !== false
    : daemonDeterministicArg !== false;
  const daemonHealthConfig = daemonHealthArg || (
    daemonConfig.health && typeof daemonConfig.health === 'object'
      ? daemonConfig.health
      : null
  );
  const daemonSession = acquireRuntimeDaemonSession({
    enabled: daemonEnabled,
    sessionKey: daemonSessionKeyFromArg || daemonConfig.sessionKey || process.env.PAIROFCLEATS_INDEX_DAEMON_SESSION || null,
    cacheRoot,
    repoRoot: root,
    deterministic: daemonDeterministic,
    profile: profile.id,
    health: daemonHealthConfig
  });
  if (daemonSession) {
    log(`[init] daemon session: ${daemonSession.key} (jobs=${daemonSession.jobsProcessed}, deterministic=${daemonSession.deterministic !== false}).`);
  }
  const envelope = await timeInit('runtime envelope', () => resolveRuntimeEnvelope({
    argv,
    rawArgv,
    userConfig,
    autoPolicy,
    env: process.env,
    execArgv: process.execArgv,
    cpuCount: os.cpus().length,
    processInfo: {
      pid: process.pid,
      argv: process.argv,
      execPath: process.execPath,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length
    },
    toolVersion: getToolVersion()
  }));
  const logFileRaw = typeof argv['log-file'] === 'string' ? argv['log-file'].trim() : '';
  const logFormatRaw = typeof argv['log-format'] === 'string' ? argv['log-format'].trim() : '';
  const logFormatOverride = logFormatRaw ? logFormatRaw.toLowerCase() : null;
  const logDestination = logFileRaw
    ? (isAbsolutePathNative(logFileRaw) ? logFileRaw : path.resolve(root, logFileRaw))
    : null;
  if (logDestination) {
    try {
      await fs.mkdir(path.dirname(logDestination), { recursive: true });
    } catch {}
  }
  if (Array.isArray(envelope.warnings) && envelope.warnings.length) {
    for (const warning of envelope.warnings) {
      if (!warning?.message) continue;
      log(`[warn] ${warning.message}`);
    }
  }
  const telemetry = createRuntimeTelemetry();
  const preRuntimeMemoryPolicy = resolveRuntimeMemoryPolicy({
    indexingConfig,
    cpuConcurrency: envelope?.concurrency?.cpuConcurrency?.value
  });
  const schedulerAutoTuneProfile = await loadSchedulerAutoTuneProfile({
    repoCacheRoot,
    log: (line) => log(line)
  });
  const schedulerConfig = resolveSchedulerConfig({
    argv,
    rawArgv,
    envConfig,
    indexingConfig,
    runtimeConfig: userConfig.runtime || null,
    envelope,
    autoTuneProfile: schedulerAutoTuneProfile
  });
  const scheduler = createBuildScheduler({
    enabled: schedulerConfig.enabled,
    lowResourceMode: schedulerConfig.lowResourceMode,
    cpuTokens: schedulerConfig.cpuTokens,
    ioTokens: schedulerConfig.ioTokens,
    memoryTokens: schedulerConfig.memoryTokens,
    adaptive: schedulerConfig.adaptive,
    adaptiveTargetUtilization: schedulerConfig.adaptiveTargetUtilization,
    adaptiveStep: schedulerConfig.adaptiveStep,
    adaptiveMemoryReserveMb: Math.max(
      schedulerConfig.adaptiveMemoryReserveMb,
      preRuntimeMemoryPolicy?.reserveRssMb || 0
    ),
    adaptiveMemoryPerTokenMb: schedulerConfig.adaptiveMemoryPerTokenMb,
    maxCpuTokens: schedulerConfig.maxCpuTokens,
    maxIoTokens: schedulerConfig.maxIoTokens,
    maxMemoryTokens: schedulerConfig.maxMemoryTokens,
    starvationMs: schedulerConfig.starvationMs,
    queues: schedulerConfig.queues,
    writeBackpressure: schedulerConfig.writeBackpressure,
    adaptiveSurfaces: schedulerConfig.adaptiveSurfaces
  });
  const stage1Queues = resolveStage1Queues(indexingConfig);
  const triageConfig = getTriageConfig(root, userConfig);
  const recordsConfig = normalizeRecordsConfig(userConfig.records || {});
  const currentIndexRoot = resolveIndexRoot(root, userConfig);
  const configHash = getEffectiveConfigHash(root, policyConfig);
  const contentConfigHash = buildContentConfigHash(policyConfig, envConfig);
  const scmProviderOverride = typeof argv['scm-provider'] === 'string'
    ? argv['scm-provider']
    : (typeof argv.scmProvider === 'string' ? argv.scmProvider : null);
  const scmProviderSetting = scmProviderOverride || scmConfig?.provider || 'auto';
  let scmSelection = getScmProviderAndRoot({
    provider: scmProviderSetting,
    startPath: root,
    log
  });
  if (scmSelection.provider === 'none') {
    log('[scm] provider=none; SCM provenance unavailable.');
  }
  let scmProvenanceFailed = false;
  const repoProvenance = await timeInit('repo provenance', async () => {
    try {
      const provenance = await scmSelection.providerImpl.getRepoProvenance({
        repoRoot: scmSelection.repoRoot
      });
      return {
        ...provenance,
        provider: provenance?.provider || scmSelection.provider,
        root: provenance?.root || scmSelection.repoRoot,
        detectedBy: provenance?.detectedBy ?? scmSelection.detectedBy
      };
    } catch (err) {
      const message = err?.message || String(err);
      log(`[scm] Failed to read repo provenance; falling back to provider=none. (${message})`);
      scmProvenanceFailed = true;
      return {
        provider: 'none',
        root: scmSelection.repoRoot,
        head: null,
        dirty: null,
        detectedBy: scmSelection.detectedBy || 'none',
        isRepo: false
      };
    }
  });
  if (scmProvenanceFailed && scmSelection.provider !== 'none') {
    log('[scm] disabling provider after provenance failure; falling back to provider=none.');
    scmSelection = {
      ...scmSelection,
      provider: 'none',
      providerImpl: getScmProvider('none'),
      detectedBy: scmSelection.detectedBy || 'none'
    };
  }
  const toolVersion = getToolVersion();
  const scmHeadId = repoProvenance?.head?.changeId
    || repoProvenance?.head?.commitId
    || repoProvenance?.commit
    || null;
  const scmHeadShort = scmHeadId ? String(scmHeadId).slice(0, 7) : 'noscm';
  const configHash8 = configHash ? configHash.slice(0, 8) : 'nohash';
  const buildNonce = formatBuildNonce();
  const computedBuildIdBase = `${formatBuildTimestamp(new Date())}_${buildNonce}_${scmHeadShort}_${configHash8}`;
  const resolvedIndexRoot = indexRootOverride ? path.resolve(indexRootOverride) : null;
  const buildsRoot = getBuildsRoot(root, userConfig);
  let computedBuildId = computedBuildIdBase;
  let buildRoot = resolvedIndexRoot || path.join(buildsRoot, computedBuildId);
  if (!resolvedIndexRoot) {
    let suffix = 1;
    while (fsSync.existsSync(buildRoot)) {
      computedBuildId = `${computedBuildIdBase}_${suffix.toString(36)}`;
      buildRoot = path.join(buildsRoot, computedBuildId);
      suffix += 1;
    }
  }
  const buildId = resolvedIndexRoot ? path.basename(buildRoot) : computedBuildId;
  const stage1SubprocessOwnershipPrefix = buildStage1SubprocessOwnershipPrefix({ buildId });
  const daemonJobContext = createRuntimeDaemonJobContext(daemonSession, {
    root,
    buildId
  });
  if (buildRoot) {
    const suffix = resolvedIndexRoot ? ' (override)' : '';
    log(`[init] build root: ${buildRoot}${suffix}`);
  }
  if (currentIndexRoot) {
    log(`[init] current index root: ${currentIndexRoot}`);
  }
  const loggingConfig = userConfig.logging || {};
  configureRuntimeLogger({
    envConfig,
    loggingConfig,
    buildId,
    configHash,
    stage,
    root,
    logDestination,
    logFormatOverride
  });
  const toolingConfig = getToolingConfig(root, userConfig);
  const toolingEnabled = toolingConfig.autoEnableOnDetect !== false;
  const postingsConfig = normalizePostingsConfig(indexingConfig.postings || {});
  const rawLexiconConfig = indexingConfig.lexicon && typeof indexingConfig.lexicon === 'object'
    ? indexingConfig.lexicon
    : {};
  const policyQualityValue = typeof autoPolicy?.quality?.value === 'string'
    ? autoPolicy.quality.value
    : null;
  const rawLexiconRelations = rawLexiconConfig.relations && typeof rawLexiconConfig.relations === 'object'
    ? rawLexiconConfig.relations
    : {};
  const rawLexiconDrop = rawLexiconRelations.drop && typeof rawLexiconRelations.drop === 'object'
    ? rawLexiconRelations.drop
    : {};
  const lexiconConfig = {
    enabled: rawLexiconConfig.enabled !== false,
    relations: {
      enabled: typeof rawLexiconRelations.enabled === 'boolean'
        ? rawLexiconRelations.enabled
        : policyQualityValue === 'max',
      stableDedupe: rawLexiconRelations.stableDedupe === true,
      drop: {
        keywords: rawLexiconDrop.keywords !== false,
        literals: rawLexiconDrop.literals !== false,
        builtins: rawLexiconDrop.builtins === true,
        types: rawLexiconDrop.types === true
      }
    }
  };
  if (rawLexiconConfig.languageOverrides && typeof rawLexiconConfig.languageOverrides === 'object') {
    lexiconConfig.languageOverrides = rawLexiconConfig.languageOverrides;
  }
  const { maxFileBytes, fileCaps, guardrails } = resolveFileCapsAndGuardrails(indexingConfig);
  const astDataflowEnabled = indexingConfig.astDataflow !== false;
  const controlFlowEnabled = indexingConfig.controlFlow !== false;
  const typeInferenceEnabled = indexingConfig.typeInference !== false;
  const typeInferenceCrossFileEnabled = indexingConfig.typeInferenceCrossFile !== false;
  const riskAnalysisEnabled = indexingConfig.riskAnalysis !== false;
  const riskAnalysisCrossFileEnabled = riskAnalysisEnabled
    && indexingConfig.riskAnalysisCrossFile !== false;
  const riskConfig = normalizeRiskConfig({
    enabled: riskAnalysisEnabled,
    rules: indexingConfig.riskRules,
    caps: indexingConfig.riskCaps,
    regex: indexingConfig.riskRegex || indexingConfig.riskRules?.regex
  }, { rootDir: root });
  const riskInterproceduralConfig = normalizeRiskInterproceduralConfig(
    indexingConfig.riskInterprocedural,
    {}
  );
  const riskInterproceduralEnabled = riskAnalysisEnabled && riskInterproceduralConfig.enabled;
  const scmAnnotateEnabled = scmConfig?.annotate?.enabled !== false;
  const effectiveScmAnnotateEnabled = scmAnnotateEnabled && scmSelection.provider !== 'none';
  const scmAnnotateTimeoutMs = Number.isFinite(Number(scmConfig?.annotate?.timeoutMs))
    ? Math.max(0, Math.floor(Number(scmConfig.annotate.timeoutMs)))
    : null;
  const scmAnnotateTimeoutLadder = Array.isArray(scmConfig?.annotate?.timeoutLadderMs)
    ? scmConfig.annotate.timeoutLadderMs
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.max(1, Math.floor(value)))
    : [];
  if (scmAnnotateEnabled && scmSelection.provider === 'none') {
    log('[scm] annotate disabled: provider=none.');
  }
  const gitBlameEnabled = effectiveScmAnnotateEnabled;
  const scmTimeoutMs = Number.isFinite(Number(scmConfig?.timeoutMs))
    ? Math.max(0, Math.floor(Number(scmConfig.timeoutMs)))
    : null;
  log(
    `[scm] policy provider=${scmSelection.provider} annotate=${gitBlameEnabled ? 'on' : 'off'} ` +
      `benchRun=${envConfig.benchRun === true ? '1' : '0'} ` +
      `metaTimeoutMs=${scmTimeoutMs ?? 'default'} ` +
      `annotateTimeoutMs=${scmAnnotateTimeoutMs ?? 'default'} ` +
      `annotateLadder=${scmAnnotateTimeoutLadder.length ? scmAnnotateTimeoutLadder.join('>') : 'default'}`
  );
  const lintEnabled = indexingConfig.lint !== false;
  const complexityEnabled = indexingConfig.complexity !== false;
  const analysisPolicy = buildAnalysisPolicy({
    toolingEnabled,
    typeInferenceEnabled,
    typeInferenceCrossFileEnabled,
    riskAnalysisEnabled,
    riskAnalysisCrossFileEnabled,
    riskInterproceduralEnabled,
    riskInterproceduralSummaryOnly: riskInterproceduralConfig.summaryOnly,
    gitBlameEnabled
  });
  const skipUnknownLanguages = indexingConfig.skipUnknownLanguages === true;
  const skipOnParseError = indexingConfig.skipOnParseError === true;
  const yamlChunkingModeRaw = typeof indexingConfig.yamlChunking === 'string'
    ? indexingConfig.yamlChunking.trim().toLowerCase()
    : '';
  const yamlChunkingMode = ['auto', 'root', 'top-level'].includes(yamlChunkingModeRaw)
    ? yamlChunkingModeRaw
    : 'auto';
  const yamlTopLevelMaxBytesRaw = Number(indexingConfig.yamlTopLevelMaxBytes);
  const yamlTopLevelMaxBytes = Number.isFinite(yamlTopLevelMaxBytesRaw)
    ? Math.max(0, Math.floor(yamlTopLevelMaxBytesRaw))
    : 200 * 1024;
  const kotlinConfig = indexingConfig.kotlin || {};
  const kotlinFlowMaxBytes = normalizeLimit(kotlinConfig.flowMaxBytes, 200 * 1024);
  const kotlinFlowMaxLines = normalizeLimit(kotlinConfig.flowMaxLines, 3000);
  const kotlinRelationsMaxBytes = normalizeLimit(kotlinConfig.relationsMaxBytes, 200 * 1024);
  const kotlinRelationsMaxLines = normalizeLimit(kotlinConfig.relationsMaxLines, 2000);
  const parserConfig = normalizeLanguageParserConfig(indexingConfig);
  const typescriptConfig = indexingConfig.typescript || {};
  const typescriptImportsOnly = typescriptConfig.importsOnly === true;
  const typescriptEmbeddingBatchRaw = Number(typescriptConfig.embeddingBatchMultiplier);
  const typescriptEmbeddingBatchMultiplier = Number.isFinite(typescriptEmbeddingBatchRaw)
    && typescriptEmbeddingBatchRaw > 0
    ? typescriptEmbeddingBatchRaw
    : null;
  const embeddingBatchMultipliers = normalizeEmbeddingBatchMultipliers(
    indexingConfig.embeddingBatchMultipliers || {},
    typescriptEmbeddingBatchMultiplier ? { typescript: typescriptEmbeddingBatchMultiplier } : {}
  );
  const flowConfig = normalizeLanguageFlowConfig(indexingConfig);
  const pythonAstConfig = indexingConfig.pythonAst || {};
  const pythonAstEnabled = pythonAstConfig.enabled !== false;
  const segmentsConfig = normalizeSegmentsConfig(indexingConfig.segments || {});
  const commentsConfig = normalizeCommentConfig(indexingConfig.comments || {});
  const chunkingConfig = indexingConfig.chunking || {};
  const tokenizationConfig = indexingConfig.tokenization || {};
  const tokenizationFileStream = tokenizationConfig.fileStream !== false;
  const chunking = {
    maxBytes: normalizeLimit(chunkingConfig.maxBytes, null),
    maxLines: normalizeLimit(chunkingConfig.maxLines, null)
  };
  const treeSitterStart = Date.now();
  const {
    treeSitterEnabled,
    treeSitterLanguages,
    treeSitterConfigChunking,
    treeSitterMaxBytes,
    treeSitterMaxLines,
    treeSitterMaxParseMs,
    treeSitterByLanguage,
    treeSitterPreload,
    treeSitterPreloadConcurrency,
    treeSitterBatchByLanguage,
    treeSitterBatchEmbeddedLanguages,
    treeSitterLanguagePasses,
    treeSitterDeferMissing,
    treeSitterDeferMissingMax,
    treeSitterWorker,
    treeSitterScheduler,
    treeSitterCachePersistent,
    treeSitterCachePersistentDir
  } = resolveTreeSitterRuntime(indexingConfig);
  const resolvedTreeSitterCachePersistentDir = treeSitterCachePersistent
    ? (treeSitterCachePersistentDir
      ? (isAbsolutePathNative(treeSitterCachePersistentDir)
        ? treeSitterCachePersistentDir
        : path.resolve(root, treeSitterCachePersistentDir))
      : path.join(repoCacheRoot, 'tree-sitter-chunk-cache'))
    : null;
  logInit('tree-sitter config', treeSitterStart);
  const applyTreeSitterJsCaps = (caps, maxBytes) => {
    if (!caps || !Number.isFinite(maxBytes) || maxBytes <= 0) return false;
    const targets = ['.js', '.jsx', '.mjs', '.cjs', '.jsm'];
    let applied = false;
    for (const ext of targets) {
      const current = caps.byExt?.[ext] || {};
      if (current.maxBytes != null) continue;
      caps.byExt[ext] = { ...current, maxBytes };
      applied = true;
    }
    return applied;
  };
  if (applyTreeSitterJsCaps(fileCaps, treeSitterMaxBytes)) {
    log(`JS file caps default to tree-sitter maxBytes (${treeSitterMaxBytes}).`);
  }
  const sqlConfig = userConfig.sql || {};
  const defaultSqlDialects = {
    '.psql': 'postgres',
    '.pgsql': 'postgres',
    '.mysql': 'mysql',
    '.sqlite': 'sqlite'
  };
  const sqlDialectByExt = { ...defaultSqlDialects, ...(sqlConfig.dialectByExt || {}) };
  const sqlDialectOverride = typeof sqlConfig.dialect === 'string' && sqlConfig.dialect.trim()
    ? sqlConfig.dialect.trim()
    : '';
  const resolveSqlDialect = (ext) => (sqlDialectOverride || sqlDialectByExt[ext] || 'generic');
  const twoStageEnabled = twoStageConfig.enabled === true;
  const twoStageBackground = twoStageConfig.background === true;
  const twoStageQueue = twoStageConfig.queue !== false && twoStageBackground;

  const {
    cpuCount,
    maxConcurrencyCap,
    fileConcurrency,
    importConcurrency,
    ioConcurrency,
    cpuConcurrency
  } = {
    cpuCount: envelope.concurrency.cpuCount,
    maxConcurrencyCap: envelope.concurrency.maxConcurrencyCap,
    fileConcurrency: envelope.concurrency.fileConcurrency.value,
    importConcurrency: envelope.concurrency.importConcurrency.value,
    ioConcurrency: envelope.concurrency.ioConcurrency.value,
    cpuConcurrency: envelope.concurrency.cpuConcurrency.value
  };
  const normalizedScmMaxConcurrentProcesses = Number.isFinite(Number(scmConfig?.maxConcurrentProcesses))
    ? Math.max(1, Math.floor(Number(scmConfig.maxConcurrentProcesses)))
    : Math.max(
      1,
      Math.floor(
        cpuConcurrency
        || fileConcurrency
        || ioConcurrency
        || 1
      )
    );
  setScmRuntimeConfig({
    ...scmConfig,
    repoHeadId: scmHeadId || null,
    repoProvenance,
    maxConcurrentProcesses: normalizedScmMaxConcurrentProcesses,
    runtime: {
      cpuCount,
      maxConcurrencyCap,
      fileConcurrency,
      ioConcurrency,
      cpuConcurrency
    }
  });
  const runtimeMemoryPolicy = resolveRuntimeMemoryPolicy({
    indexingConfig,
    cpuConcurrency
  });
  const rawWorkerPoolConfig = indexingConfig.workerPool && typeof indexingConfig.workerPool === 'object'
    ? indexingConfig.workerPool
    : {};
  if (rawWorkerPoolConfig.heapTargetMb == null || rawWorkerPoolConfig.heapMinMb == null || rawWorkerPoolConfig.heapMaxMb == null) {
    indexingConfig = mergeConfig(indexingConfig, {
      workerPool: {
        ...(rawWorkerPoolConfig.heapTargetMb == null
          ? { heapTargetMb: runtimeMemoryPolicy.workerHeapPolicy.targetPerWorkerMb }
          : {}),
        ...(rawWorkerPoolConfig.heapMinMb == null
          ? { heapMinMb: runtimeMemoryPolicy.workerHeapPolicy.minPerWorkerMb }
          : {}),
        ...(rawWorkerPoolConfig.heapMaxMb == null
          ? { heapMaxMb: runtimeMemoryPolicy.workerHeapPolicy.maxPerWorkerMb }
          : {})
      }
    });
  }

  const embeddingRuntime = await timeInit('embedding runtime', () => resolveEmbeddingRuntime({
    rootDir: root,
    userConfig,
    recordsDir: triageConfig.recordsDir,
    recordsConfig,
    indexingConfig,
    envConfig,
    argv,
    cpuConcurrency
  }));
  const {
    embeddingBatchSize,
    embeddingConcurrency,
    embeddingEnabled,
    embeddingMode: resolvedEmbeddingMode,
    embeddingService,
    embeddingProvider,
    embeddingOnnx,
    embeddingNormalize,
    embeddingQueue,
    embeddingIdentity,
    embeddingIdentityKey,
    embeddingCache,
    useStubEmbeddings,
    modelConfig,
    modelId,
    modelsDir,
    getChunkEmbedding,
    getChunkEmbeddings
  } = embeddingRuntime;
  const daemonPrewarmEmbeddings = daemonConfig.prewarmEmbeddings !== false;
  const embeddingWarmKey = `${embeddingProvider || 'unknown'}:${modelId || 'none'}:${modelsDir || 'none'}:${embeddingNormalize !== false}`;
  const daemonEmbeddingWarmHit = daemonSession
    ? hasDaemonEmbeddingWarmKey(daemonSession, embeddingWarmKey)
    : false;
  if (
    daemonSession
    && daemonPrewarmEmbeddings
    && embeddingEnabled
    && useStubEmbeddings !== true
    && !daemonEmbeddingWarmHit
  ) {
    await timeInit('embedding prewarm', () => warmEmbeddingAdapter({
      rootDir: root,
      provider: embeddingProvider,
      onnxConfig: embeddingOnnx,
      normalize: embeddingNormalize,
      useStub: false,
      modelId,
      modelsDir
    }));
    addDaemonEmbeddingWarmKey(daemonSession, embeddingWarmKey);
  }
  const pythonAstRuntimeConfig = {
    ...pythonAstConfig,
    defaultMaxWorkers: Math.min(4, fileConcurrency),
    hardMaxWorkers: 8
  };
  const workerPoolConfig = resolveWorkerPoolRuntimeConfig({
    indexingConfig,
    envConfig,
    cpuConcurrency,
    fileConcurrency
  });
  const procConcurrencyCap = Number.isFinite(fileConcurrency)
    ? Math.max(
      Math.max(1, Math.floor(cpuConcurrency || 1)),
      Math.floor(fileConcurrency / 2)
    )
    : Math.max(1, Math.floor(cpuConcurrency || 1));
  const procConcurrency = workerPoolConfig?.enabled !== false && Number.isFinite(workerPoolConfig?.maxWorkers)
    ? Math.max(1, Math.min(procConcurrencyCap, Math.floor(workerPoolConfig.maxWorkers)))
    : null;
  const queueConfig = createRuntimeQueues({
    ioConcurrency,
    cpuConcurrency,
    fileConcurrency,
    embeddingConcurrency,
    pendingLimits: envelope.queues,
    scheduler,
    stage1Queues,
    procConcurrency,
    memoryPolicy: runtimeMemoryPolicy
  });
  const { queues } = queueConfig;

  const incrementalEnabled = argv.incremental === true;
  const incrementalBundlesConfig = indexingConfig.incrementalBundles || {};
  const incrementalBundleFormat = typeof incrementalBundlesConfig.format === 'string'
    ? normalizeBundleFormat(incrementalBundlesConfig.format)
    : null;
  const debugCrash = argv['debug-crash'] === true
    || envConfig.debugCrash === true
    || indexingConfig.debugCrash === true
    || isTestingEnv();

  const dictStartedAt = Date.now();
  const dictConfig = getDictConfig(root, userConfig);
  const dictDir = dictConfig?.dir;
  const dictionaryPaths = await getDictionaryPaths(root, dictConfig);
  const codeDictLanguages = normalizeCodeDictLanguages(DEFAULT_CODE_DICT_LANGUAGES);
  const codeDictEnabled = codeDictLanguages.size > 0;
  const codeDictPaths = codeDictEnabled
    ? await getCodeDictionaryPaths(root, dictConfig, { languages: Array.from(codeDictLanguages) })
    : { baseDir: path.join(dictDir || '', 'code-dicts'), common: [], byLanguage: new Map(), all: [] };
  const dictSignatureParts = [];
  for (const dictFile of dictionaryPaths) {
    const signaturePath = normalizeDictSignaturePath({ dictFile, dictDir, repoRoot: root });
    try {
      const stat = await fs.stat(dictFile);
      dictSignatureParts.push(`${signaturePath}:${stat.size}:${stat.mtimeMs}`);
    } catch {
      dictSignatureParts.push(`${signaturePath}:missing`);
    }
  }
  for (const dictFile of codeDictPaths.all) {
    const signaturePath = normalizeDictSignaturePath({ dictFile, dictDir, repoRoot: root });
    try {
      const stat = await fs.stat(dictFile);
      dictSignatureParts.push(`code:${signaturePath}:${stat.size}:${stat.mtimeMs}`);
    } catch {
      dictSignatureParts.push(`code:${signaturePath}:missing`);
    }
  }
  dictSignatureParts.sort();
  const dictSignature = dictSignatureParts.length
    ? sha1(dictSignatureParts.join('|'))
    : null;
  const cachedDaemonDict = cloneDaemonDictionaryEntry(
    daemonSession && dictSignature
      ? getDaemonDictionaryCacheEntry(daemonSession, dictSignature)
      : null
  );
  const dictWords = cachedDaemonDict?.dictWords || new Set();
  const codeDictCommonWords = cachedDaemonDict?.codeDictCommonWords || new Set();
  const codeDictWordsByLanguage = cachedDaemonDict?.codeDictWordsByLanguage || new Map();
  const codeDictWordsAll = cachedDaemonDict?.codeDictWordsAll || new Set();
  const daemonDictCacheHit = Boolean(cachedDaemonDict);
  if (!daemonDictCacheHit) {
    for (const dictFile of dictionaryPaths) {
      try {
        const contents = await fs.readFile(dictFile, 'utf8');
        for (const line of contents.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) dictWords.add(trimmed);
        }
      } catch {}
    }
    const addCodeWord = (target, word) => {
      if (!word) return;
      const normalized = word.toLowerCase();
      if (!normalized) return;
      target.add(normalized);
      codeDictWordsAll.add(normalized);
    };
    for (const dictFile of codeDictPaths.common) {
      try {
        const contents = await fs.readFile(dictFile, 'utf8');
        for (const line of contents.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) addCodeWord(codeDictCommonWords, trimmed);
        }
      } catch {}
    }
    for (const [lang, dictFiles] of codeDictPaths.byLanguage.entries()) {
      const words = new Set();
      for (const dictFile of dictFiles) {
        try {
          const contents = await fs.readFile(dictFile, 'utf8');
          for (const line of contents.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed) addCodeWord(words, trimmed);
          }
        } catch {}
      }
      if (words.size) {
        codeDictWordsByLanguage.set(lang, words);
      }
    }
  } else {
    log('[init] dictionaries loaded from daemon warm cache.');
  }
  const dictSummary = {
    files: dictionaryPaths.length,
    words: dictWords.size,
    code: {
      files: codeDictPaths.all.length,
      words: codeDictWordsAll.size,
      languages: Array.from(codeDictWordsByLanguage.keys()).sort(),
      bundleProfileVersion: typeof codeDictPaths?.bundleProfileVersion === 'string'
        ? codeDictPaths.bundleProfileVersion
        : null
    }
  };
  if (daemonSession && dictSignature && !daemonDictCacheHit) {
    setDaemonDictionaryCacheEntry(daemonSession, dictSignature, {
      dictWords,
      codeDictCommonWords,
      codeDictWordsAll,
      codeDictWordsByLanguage,
      dictSummary
    });
  }
  const LARGE_DICT_SHARED_THRESHOLD = 200000;
  const shouldShareDict = dictSummary.words
    && (workerPoolConfig.enabled !== false || dictSummary.words >= LARGE_DICT_SHARED_THRESHOLD);
  const dictSharedPayload = shouldShareDict ? createSharedDictionary(dictWords) : null;
  const dictShared = dictSharedPayload ? createSharedDictionaryView(dictSharedPayload) : null;
  logInit('dictionaries', dictStartedAt);
  const generatedPolicy = buildGeneratedIndexingPolicyConfig(indexingConfig);

  const {
    ignoreMatcher,
    config: ignoreConfig,
    ignoreFiles,
    warnings: ignoreWarnings
  } = await timeInit('ignore rules', () => buildIgnoreMatcher({ root, userConfig, generatedPolicy }));
  const cacheConfig = getCacheRuntimeConfig(root, userConfig);
  const verboseCache = envConfig.verbose === true;

  if (dictSummary.files) {
    log(`Wordlists enabled: ${dictSummary.files} file(s), ${dictSummary.words.toLocaleString()} words for identifier splitting.`);
  } else {
    log('Wordlists disabled: no dictionary files found; identifier splitting will be limited.');
  }
  if (codeDictEnabled && dictSummary.code?.files) {
    const langs = dictSummary.code.languages && dictSummary.code.languages.length
      ? ` (${dictSummary.code.languages.join(', ')})`
      : '';
    const bundleSuffix = dictSummary.code.bundleProfileVersion
      ? ` [bundle=${dictSummary.code.bundleProfileVersion}]`
      : '';
    log(
      `Code dictionaries enabled: ${dictSummary.code.files} file(s), `
      + `${dictSummary.code.words.toLocaleString()} words${langs}${bundleSuffix}.`
    );
  } else if (codeDictEnabled) {
    log('Code dictionaries enabled: no code dictionary files found for gated languages.');
  } else {
    log('Code dictionaries disabled: no gated languages configured.');
  }
  if (ignoreWarnings?.length) {
    for (const warning of ignoreWarnings) {
      const detail = warning?.detail ? ` (${warning.detail})` : '';
      const file = warning?.file ? ` ${warning.file}` : '';
      log(`[ignore] ${warning?.type || 'warning'}${file}${detail}`);
    }
  }
  if (stage === 'stage1') {
    log('Two-stage indexing: stage1 (sparse) overrides enabled.');
  } else if (stage === 'stage2') {
    log('Two-stage indexing: stage2 (enrichment) running.');
  } else if (stage === 'stage3') {
    log('Indexing stage3 (embeddings pass) running.');
  } else if (stage === 'stage4') {
    log('Indexing stage4 (sqlite/ann pass) running.');
  }
  log(`Index profile: ${profile.id}.`);
  if (hugeRepoProfileEnabled) {
    log(
      `Huge-repo profile enabled (${autoPolicyProfile.id || 'huge-repo'}): ` +
      'cross-file enrichment and expensive relation passes are reduced by default.'
    );
  }
  if (!embeddingEnabled) {
    const label = embeddingService ? 'service queue' : 'disabled';
    const deferred = baseEmbeddingsPlanned && (stage === 'stage1' || stage === 'stage2');
    if (deferred) {
      const stageLabel = stage === 'stage1' ? 'stage1' : 'stage2';
      log(`Embeddings: deferred to stage3 (${stageLabel}).`);
    } else {
      log(`Embeddings: ${label}.`);
    }
  } else if (useStubEmbeddings) {
    log('Embeddings: stub mode enabled (no model downloads).');
  } else {
    const providerLabel = embeddingProvider === 'onnx' ? 'onnxruntime' : 'xenova';
    log(`Embeddings: model ${modelId} (${providerLabel}).`);
  }
  if (embeddingEnabled) {
    log(`Embedding batch size: ${embeddingBatchSize}`);
    log(`Embedding concurrency: ${embeddingConcurrency}`);
  }
  if (incrementalEnabled) {
    log(`Incremental cache enabled (root: ${path.join(repoCacheRoot, 'incremental')}).`);
  }
  log(`Queue concurrency: io=${ioConcurrency}, cpu=${cpuConcurrency}.`);
  log(
    `Memory policy: workerHeap=${runtimeMemoryPolicy.workerHeapPolicy.targetPerWorkerMb}MB ` +
    `(effective=${runtimeMemoryPolicy.effectiveWorkerHeapMb}MB, ` +
    `min=${runtimeMemoryPolicy.workerHeapPolicy.minPerWorkerMb}MB, ` +
    `max=${runtimeMemoryPolicy.workerHeapPolicy.maxPerWorkerMb}MB), ` +
    `workerCache=${runtimeMemoryPolicy.perWorkerCacheMb}MB, ` +
    `writeBuffer=${runtimeMemoryPolicy.perWorkerWriteBufferMb}MB.`
  );
  if (runtimeMemoryPolicy?.highMemoryProfile?.enabled) {
    const mode = runtimeMemoryPolicy.highMemoryProfile.applied ? 'applied' : 'eligible';
    log(
      `High-memory profile (${mode}): threshold=${runtimeMemoryPolicy.highMemoryProfile.thresholdMb}MB, ` +
      `cacheScale=${runtimeMemoryPolicy.highMemoryProfile.cacheScale}x, ` +
      `writeScale=${runtimeMemoryPolicy.highMemoryProfile.writeBufferScale}x, ` +
      `postingsScale=${runtimeMemoryPolicy.highMemoryProfile.postingsScale}x.`
    );
  }
  if (!astDataflowEnabled) {
    log('AST dataflow metadata disabled via indexing.astDataflow.');
  }
  if (!controlFlowEnabled) {
    log('Control-flow metadata disabled via indexing.controlFlow.');
  }
  if (!pythonAstEnabled) {
    log('Python AST metadata disabled via indexing.pythonAst.enabled.');
  }
  if (!treeSitterEnabled) {
    log('Tree-sitter chunking disabled via indexing.treeSitter.enabled.');
  } else {
    const preloadCacheKey = JSON.stringify({
      languages: Array.isArray(treeSitterLanguages)
        ? treeSitterLanguages.slice().sort()
        : [],
      preload: treeSitterPreload !== false,
      preloadConcurrency: Number(treeSitterPreloadConcurrency) || 0
    });
    const cachedPreloadCount = Number(getDaemonTreeSitterCacheEntry(daemonSession, preloadCacheKey));
    if (Number.isFinite(cachedPreloadCount) && cachedPreloadCount >= 0) {
      if (cachedPreloadCount > 0) {
        log(`[init] tree-sitter preload warm hit (${cachedPreloadCount} languages).`);
      }
    } else {
      const preloadStart = Date.now();
      const preloadCount = await preloadTreeSitterRuntimeLanguages({
        treeSitterEnabled,
        treeSitterLanguages,
        treeSitterPreload,
        treeSitterPreloadConcurrency,
        observedLanguages: null,
        log
      });
      setDaemonTreeSitterCacheEntry(daemonSession, preloadCacheKey, preloadCount);
      if (preloadCount > 0) {
        logInit('tree-sitter preload', preloadStart);
      }
    }
  }
  if (typeInferenceEnabled) {
    log('Type inference metadata enabled via indexing.typeInference.');
  }
  if (typeInferenceCrossFileEnabled && !typeInferenceEnabled) {
    log('Cross-file type inference requested but indexing.typeInference is disabled.');
  }
  if (!gitBlameEnabled) {
    log('SCM annotate metadata disabled via indexing.scm.annotate.enabled.');
  }
  if (!lintEnabled) {
    log('Lint metadata disabled via indexing.lint.');
  }
  if (!complexityEnabled) {
    log('Complexity metadata disabled via indexing.complexity.');
  }
  if (!riskAnalysisEnabled) {
    log('Risk analysis disabled via indexing.riskAnalysis.');
  }
  if (!riskAnalysisCrossFileEnabled && riskAnalysisEnabled) {
    log('Cross-file risk correlation disabled via indexing.riskAnalysisCrossFile.');
  }
  if (postingsConfig.enablePhraseNgrams === false) {
    log('Phrase n-gram postings disabled via indexing.postings.enablePhraseNgrams.');
  }
  if (postingsConfig.enableChargrams === false) {
    log('Chargram postings disabled via indexing.postings.enableChargrams.');
  }
  if (lexiconConfig.enabled === false) {
    log('Lexicon features disabled via indexing.lexicon.enabled.');
  }

  const workerPoolsResult = await timeInit('worker pools', () => createRuntimeWorkerPools({
    workerPoolConfig,
    repoCacheRoot,
    dictWords,
    dictSharedPayload,
    dictConfig,
    codeDictWords: codeDictCommonWords,
    codeDictWordsByLanguage,
    codeDictLanguages,
    postingsConfig,
    treeSitterConfig: {
      enabled: treeSitterEnabled,
      languages: treeSitterLanguages,
      maxBytes: treeSitterMaxBytes,
      maxLines: treeSitterMaxLines,
      maxParseMs: treeSitterMaxParseMs,
      byLanguage: treeSitterByLanguage,
      deferMissing: treeSitterDeferMissing
    },
    debugCrash,
    log
  }));
  const { workerPools, workerPool, quantizePool } = workerPoolsResult;

  log('Build environment snapshot.', {
    event: 'build.env',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount,
    memoryMb: Math.round(os.totalmem() / (1024 * 1024)),
    configHash,
    stage: stage || null,
    features: {
      embeddings: embeddingEnabled || embeddingService,
      treeSitter: treeSitterEnabled,
      relations: stage !== 'stage1',
      tooling: toolingEnabled,
      typeInference: typeInferenceEnabled,
      riskAnalysis: riskAnalysisEnabled
    }
  });

  const fileScan = buildFileScanConfig(indexingConfig);
  const shardConfig = buildShardConfig(indexingConfig);

  const languageOptions = {
    rootDir: root,
    astDataflowEnabled,
    controlFlowEnabled,
    skipUnknownLanguages,
    skipOnParseError,
    javascript: {
      parser: parserConfig.javascript,
      flow: flowConfig.javascript
    },
    typescript: {
      parser: parserConfig.typescript,
      importsOnly: typescriptImportsOnly
    },
    embeddingBatchMultipliers,
    chunking,
    tokenization: {
      fileStream: tokenizationFileStream
    },
    pythonAst: pythonAstRuntimeConfig,
    kotlin: {
      flowMaxBytes: kotlinFlowMaxBytes,
      flowMaxLines: kotlinFlowMaxLines,
      relationsMaxBytes: kotlinRelationsMaxBytes,
      relationsMaxLines: kotlinRelationsMaxLines
    },
    treeSitter: {
      enabled: treeSitterEnabled,
      languages: treeSitterLanguages,
      configChunking: treeSitterConfigChunking,
      maxBytes: treeSitterMaxBytes,
      maxLines: treeSitterMaxLines,
      maxParseMs: treeSitterMaxParseMs,
      byLanguage: treeSitterByLanguage,
      preload: treeSitterPreload,
      preloadConcurrency: treeSitterPreloadConcurrency,
      batchByLanguage: treeSitterBatchByLanguage,
      batchEmbeddedLanguages: treeSitterBatchEmbeddedLanguages,
      languagePasses: treeSitterLanguagePasses,
      deferMissing: treeSitterDeferMissing,
      deferMissingMax: treeSitterDeferMissingMax,
      cachePersistent: treeSitterCachePersistent,
      cachePersistentDir: resolvedTreeSitterCachePersistentDir,
      worker: treeSitterWorker,
      scheduler: treeSitterScheduler || { transport: 'disk', sharedCache: false }
    },
    resolveSqlDialect,
    yamlChunking: {
      mode: yamlChunkingMode,
      maxBytes: yamlTopLevelMaxBytes
    },
    lexicon: lexiconConfig,
    log
  };

  try {
    await fs.mkdir(buildRoot, { recursive: true });
  } catch {}
  logInit('runtime ready', initStartedAt);

  return {
    envelope,
    root,
    argv,
    rawArgv,
    userConfig,
    repoCacheRoot,
    platformRuntimePreset,
    startupCalibration,
    learnedAutoProfile,
    daemon: daemonSession
      ? {
        enabled: true,
        sessionKey: daemonSession.key,
        deterministic: daemonSession.deterministic !== false,
        jobContext: daemonJobContext,
        generation: daemonSession.generation || 1,
        generationJobsProcessed: daemonSession.generationJobsProcessed || 0,
        jobsProcessed: daemonSession.jobsProcessed,
        recycle: {
          count: daemonSession.recycleCount || 0,
          lastAt: daemonSession.lastRecycleAt || null,
          lastReasons: daemonSession.lastRecycleReasons || []
        },
        warmCaches: {
          dictionaries: daemonSession.dictCache?.size || 0,
          treeSitterPreload: daemonSession.treeSitterPreloadCache?.size || 0,
          embeddings: daemonSession.embeddingWarmKeys?.size || 0
        }
      }
      : {
        enabled: false,
        sessionKey: null,
        deterministic: true,
        jobContext: null,
        jobsProcessed: 0,
        warmCaches: {
          dictionaries: 0,
          treeSitterPreload: 0,
          embeddings: 0
        }
      },
    buildId,
    buildRoot,
    profile,
    indexOptimizationProfile,
    recordsDir: triageConfig.recordsDir,
    recordsConfig,
    currentIndexRoot,
    configHash,
    repoProvenance,
    scmConfig,
    scmProvider: scmSelection.provider,
    scmRepoRoot: scmSelection.repoRoot,
    scmProviderImpl: scmSelection.providerImpl,
    toolInfo: {
      tool: 'pairofcleats',
      version: toolVersion,
      configHash: contentConfigHash || null
    },
    autoPolicyProfile,
    hugeRepoProfileEnabled,
    toolingConfig,
    toolingEnabled,
    indexingConfig,
    postingsConfig,
    segmentsConfig,
    commentsConfig,
    astDataflowEnabled,
    controlFlowEnabled,
    typeInferenceEnabled,
    typeInferenceCrossFileEnabled,
    riskAnalysisEnabled,
    riskAnalysisCrossFileEnabled,
    riskInterproceduralConfig,
    riskInterproceduralEnabled,
    riskConfig,
    embeddingBatchSize,
    embeddingConcurrency,
    embeddingEnabled,
    embeddingMode: resolvedEmbeddingMode,
    embeddingService,
    embeddingProvider,
    embeddingOnnx,
    embeddingNormalize,
    embeddingQueue,
    embeddingIdentity,
    embeddingIdentityKey,
    embeddingCache,
    fileCaps,
    guardrails,
    fileScan,
    shards: shardConfig,
    twoStage: {
      enabled: twoStageEnabled,
      background: twoStageBackground,
      stage,
      queue: twoStageQueue
    },
    stage,
    gitBlameEnabled,
    lintEnabled,
    complexityEnabled,
    analysisPolicy,
    resolveSqlDialect,
    fileConcurrency,
    importConcurrency,
    ioConcurrency,
    cpuConcurrency,
    queues,
    scheduler,
    schedulerConfig,
    memoryPolicy: runtimeMemoryPolicy,
    telemetry,
    stage1Queues,
    subprocessOwnership: {
      stage1FilePrefix: stage1SubprocessOwnershipPrefix
    },
    procConcurrency,
    incrementalEnabled,
    incrementalBundleFormat,
    debugCrash,
    useStubEmbeddings,
    modelConfig,
    modelId,
    modelsDir,
    workerPoolConfig,
    workerPools,
    workerPool,
    quantizePool,
    dictConfig,
    dictionaryPaths,
    dictWords,
    dictShared,
    dictSummary,
    dictSignature,
    codeDictWords: codeDictCommonWords,
    codeDictWordsByLanguage,
    codeDictLanguages,
    codeDictionaryPaths: codeDictPaths,
    getChunkEmbedding,
    getChunkEmbeddings,
    languageOptions,
    generatedPolicy,
    ignoreMatcher,
    ignoreConfig,
    ignoreFiles,
    ignoreWarnings,
    maxFileBytes,
    cacheConfig,
    verboseCache,
    importGraphEnabled
  };
}
