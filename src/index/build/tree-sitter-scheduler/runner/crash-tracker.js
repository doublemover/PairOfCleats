import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { sha1 } from '../../../../shared/hash.js';
import { NATIVE_GRAMMAR_MODULES } from '../../../../lang/tree-sitter/native-runtime.js';
import { parseSubprocessCrashEvents, tailLines } from './crash-utils.js';

const TREE_SITTER_RUNTIME_PACKAGE = 'tree-sitter';
const CRASH_BUNDLE_SCHEMA_VERSION = '1.0.0';
const CRASH_BUNDLE_FILE = 'crash-forensics.json';
const DEFAULT_DURABLE_DIR = '_crash-forensics';
const require = createRequire(import.meta.url);
const packageVersionCache = new Map();

/**
 * Sanitize a value so it is safe to embed in cross-platform filenames.
 *
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
const sanitizePathToken = (value, fallback = 'unknown') => {
  const raw = value == null ? '' : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned || fallback;
};

/**
 * Resolve package version from installed package metadata with memoization.
 *
 * @param {string} packageName
 * @returns {string|null}
 */
const readPackageVersion = (packageName) => {
  if (typeof packageName !== 'string' || !packageName.trim()) return null;
  const normalized = packageName.trim();
  if (packageVersionCache.has(normalized)) {
    return packageVersionCache.get(normalized);
  }
  let version = null;
  try {
    const pkgPath = require.resolve(`${normalized}/package.json`);
    const pkg = require(pkgPath);
    const parsed = typeof pkg?.version === 'string' ? pkg.version.trim() : '';
    version = parsed || null;
  } catch {
    version = null;
  }
  packageVersionCache.set(normalized, version);
  return version;
};

/**
 * Build parser metadata recorded in crash forensics and crash logs.
 *
 * @param {string|null|undefined} languageId
 * @returns {object}
 */
const resolveParserMetadata = (languageId) => {
  const normalizedLanguage = typeof languageId === 'string' && languageId
    ? languageId
    : null;
  const grammarSpec = normalizedLanguage ? NATIVE_GRAMMAR_MODULES?.[normalizedLanguage] : null;
  const grammarModule = typeof grammarSpec?.moduleName === 'string' ? grammarSpec.moduleName : null;
  return {
    provider: 'tree-sitter-native',
    languageId: normalizedLanguage,
    grammarModule,
    grammarVersion: grammarModule ? readPackageVersion(grammarModule) : null,
    parserRuntime: TREE_SITTER_RUNTIME_PACKAGE,
    parserRuntimeVersion: readPackageVersion(TREE_SITTER_RUNTIME_PACKAGE),
    parserAbi: process.versions?.modules || null,
    parserNapi: process.versions?.napi || null
  };
};

/**
 * Resolve representative failed job sample for one grammar group.
 *
 * @param {object|null|undefined} group
 * @returns {object|null}
 */
const resolveFirstFailedJob = (group) => {
  const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
  if (!jobs.length) return null;
  return jobs[0];
};

/**
 * Normalize file fingerprint fields for crash signature generation.
 *
 * @param {object|null|undefined} job
 * @returns {{hash:string|null,size:number|null,mtimeMs:number|null}}
 */
const resolveFileFingerprint = (job) => {
  const signature = job?.fileVersionSignature && typeof job.fileVersionSignature === 'object'
    ? job.fileVersionSignature
    : null;
  const hash = typeof signature?.hash === 'string' ? signature.hash : null;
  const size = Number(signature?.size);
  const mtimeMs = Number(signature?.mtimeMs);
  return {
    hash,
    size: Number.isFinite(size) ? size : null,
    mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : null
  };
};

/**
 * Build deterministic crash signature from parser/runtime/file dimensions.
 *
 * @param {{
 *  parserMetadata?:object,
 *  grammarKey?:string,
 *  fileFingerprint?:object,
 *  stage?:string,
 *  exitCode?:number,
 *  signal?:string|null
 * }} input
 * @returns {string}
 */
const buildCrashSignature = ({
  parserMetadata,
  grammarKey,
  fileFingerprint,
  stage,
  exitCode,
  signal
}) => {
  const payload = [
    parserMetadata?.provider || '',
    parserMetadata?.languageId || '',
    parserMetadata?.parserAbi || '',
    parserMetadata?.grammarModule || '',
    parserMetadata?.grammarVersion || '',
    parserMetadata?.parserRuntimeVersion || '',
    grammarKey || '',
    fileFingerprint?.hash || '',
    fileFingerprint?.size ?? '',
    stage || '',
    Number.isFinite(exitCode) ? String(exitCode) : '',
    signal || ''
  ].join('|');
  return `tscrash:${sha1(payload).slice(0, 20)}`;
};

/**
 * Resolve durable crash bundle path under repository cache roots.
 *
 * @param {{runtime?:object,outDir:string}} input
 * @returns {string|null}
 */
const resolveDurableCrashBundlePath = ({ runtime, outDir }) => {
  const repoCacheRoot = typeof runtime?.repoCacheRoot === 'string' && runtime.repoCacheRoot
    ? path.resolve(runtime.repoCacheRoot)
    : null;
  const baseDir = repoCacheRoot ? path.dirname(repoCacheRoot) : null;
  if (!baseDir) return null;
  const buildToken = sanitizePathToken(runtime?.buildId || path.basename(outDir || ''), 'build');
  const repoToken = sanitizePathToken(path.basename(repoCacheRoot), 'repo');
  const durableDir = path.join(baseDir, DEFAULT_DURABLE_DIR);
  return path.join(durableDir, `${repoToken}-${buildToken}-${CRASH_BUNDLE_FILE}`);
};

/**
 * Materialize immutable bundle snapshot from tracker state.
 *
 * @param {{
 *  runtime?:object,
 *  outDir:string,
 *  eventsBySignature:Map<string,object>,
 *  failedGrammarKeys:Set<string>,
 *  degradedVirtualPaths:Set<string>
 * }} input
 * @returns {object}
 */
const makeBundleSnapshot = ({
  runtime,
  outDir,
  eventsBySignature,
  failedGrammarKeys,
  degradedVirtualPaths
}) => ({
  schemaVersion: CRASH_BUNDLE_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  repoRoot: runtime?.root || null,
  repoCacheRoot: runtime?.repoCacheRoot || null,
  buildRoot: runtime?.buildRoot || null,
  outDir: path.resolve(outDir),
  failedGrammarKeys: Array.from(failedGrammarKeys).sort(),
  degradedVirtualPaths: Array.from(degradedVirtualPaths).sort(),
  events: Array.from(eventsBySignature.values())
    .sort((a, b) => String(a.signature).localeCompare(String(b.signature)))
});

/**
 * Create crash tracker used to persist and summarize scheduler crash forensics.
 *
 * @param {{
 *  runtime:object,
 *  outDir:string,
 *  paths:object,
 *  groupByGrammarKey:Map<string,object>,
 *  crashLogger?:object|null,
 *  log?:(line:string)=>void|null
 * }} input
 * @returns {{
 *  recordFailure: (input:object)=>Promise<void>,
 *  getFailedGrammarKeys: ()=>Set<string>,
 *  getDegradedVirtualPaths: ()=>Set<string>,
 *  getBundlePath: ()=>string,
 *  getDurableBundlePath: ()=>string|null,
 *  summarize: ()=>object,
 *  waitForPersistence: ()=>Promise<void>
 * }}
 */
export const createSchedulerCrashTracker = ({
  runtime,
  outDir,
  paths,
  groupByGrammarKey,
  crashLogger = null,
  log = null
}) => {
  const eventsBySignature = new Map();
  const failedGrammarKeys = new Set();
  const degradedVirtualPaths = new Set();
  const localBundlePath = path.join(paths.baseDir, CRASH_BUNDLE_FILE);
  const durableBundlePath = resolveDurableCrashBundlePath({ runtime, outDir });
  let persistSerial = Promise.resolve();

  /**
   * Serialize crash bundle persistence to keep on-disk snapshots deterministic.
   *
   * @param {object} bundle
   * @returns {Promise<void>}
   */
  const enqueuePersist = (bundle) => {
    persistSerial = persistSerial.then(async () => {
      await fs.mkdir(path.dirname(localBundlePath), { recursive: true });
      await fs.writeFile(localBundlePath, JSON.stringify(bundle, null, 2), 'utf8');
      if (durableBundlePath) {
        await fs.mkdir(path.dirname(durableBundlePath), { recursive: true });
        await fs.writeFile(durableBundlePath, JSON.stringify(bundle, null, 2), 'utf8');
      }
      if (typeof crashLogger?.persistForensicBundle === 'function') {
        const bundleSignature = `scheduler-${sha1(JSON.stringify({
          failedGrammarKeys: bundle?.failedGrammarKeys || [],
          degradedVirtualPaths: bundle?.degradedVirtualPaths || [],
          signatures: Array.isArray(bundle?.events)
            ? bundle.events.map((event) => event?.signature || '').filter(Boolean).sort()
            : []
        })).slice(0, 20)}`;
        await crashLogger.persistForensicBundle({
          kind: 'tree-sitter-scheduler-crash',
          signature: bundleSignature,
          bundle
        });
      }
    }).catch(() => {});
    return persistSerial;
  };

  /**
   * Mark degraded virtual paths for one grammar failure event.
   *
   * Prefers explicit crash-event virtual paths, then falls back to first failed
   * job path, then first group job path to keep degraded-mode deterministic.
   *
   * @param {{grammarKey:string,firstJob?:object|null,subprocessCrashEvents?:object[]}} input
   * @returns {void}
   */
  const addDegradedVirtualPathsForFailure = ({ grammarKey, firstJob, subprocessCrashEvents }) => {
    const failedVirtualPaths = new Set();
    const crashEvents = Array.isArray(subprocessCrashEvents) ? subprocessCrashEvents : [];
    for (const event of crashEvents) {
      const eventVirtualPath = (
        (typeof event?.virtualPath === 'string' && event.virtualPath)
        || (typeof event?.file?.virtualPath === 'string' && event.file.virtualPath)
        || (typeof event?.meta?.virtualPath === 'string' && event.meta.virtualPath)
        || null
      );
      if (eventVirtualPath) failedVirtualPaths.add(eventVirtualPath);
    }
    if (!failedVirtualPaths.size) {
      const firstVirtualPath = typeof firstJob?.virtualPath === 'string' ? firstJob.virtualPath : null;
      if (firstVirtualPath) failedVirtualPaths.add(firstVirtualPath);
    }
    if (!failedVirtualPaths.size) {
      const group = groupByGrammarKey.get(grammarKey);
      const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
      const fallbackVirtualPath = typeof jobs[0]?.virtualPath === 'string' ? jobs[0].virtualPath : null;
      if (fallbackVirtualPath) failedVirtualPaths.add(fallbackVirtualPath);
    }
    for (const virtualPath of failedVirtualPaths) {
      degradedVirtualPaths.add(virtualPath);
    }
  };

  /**
   * Record one scheduler subprocess failure into crash diagnostics artifacts.
   *
   * @param {{
   *  grammarKey:string,
   *  stage?:string,
   *  error:Error & {result?:object},
   *  taskId?:string|null,
   *  markFailed?:boolean,
   *  taskGrammarKeys?:string[]|null,
   *  inferredFailedGrammarKeys?:string[]|null
   * }} input
   * @returns {Promise<void>}
   */
  const recordFailure = async ({
    grammarKey,
    stage,
    error,
    taskId = null,
    markFailed = true,
    taskGrammarKeys = null,
    inferredFailedGrammarKeys = null
  }) => {
    if (!grammarKey) return;
    const group = groupByGrammarKey.get(grammarKey) || null;
    const firstJob = resolveFirstFailedJob(group);
    const subprocessCrashEvents = parseSubprocessCrashEvents(error);
    if (markFailed) {
      failedGrammarKeys.add(grammarKey);
      addDegradedVirtualPathsForFailure({
        grammarKey,
        firstJob,
        subprocessCrashEvents
      });
    }
    const languageId = typeof firstJob?.languageId === 'string' && firstJob.languageId
      ? firstJob.languageId
      : (Array.isArray(group?.languages) ? group.languages[0] : null);
    const parserMetadata = resolveParserMetadata(languageId);
    const fileFingerprint = resolveFileFingerprint(firstJob);
    const firstSubprocessEvent = subprocessCrashEvents[0] || null;
    const exitCode = Number(error?.result?.exitCode);
    const signal = typeof error?.result?.signal === 'string' ? error.result.signal : null;
    const stdoutTail = tailLines(error?.result?.stdout);
    const stderrTail = tailLines(error?.result?.stderr);
    const resolvedStage = typeof stage === 'string' && stage
      ? stage
      : (typeof firstSubprocessEvent?.stage === 'string' ? firstSubprocessEvent.stage : 'scheduler-subprocess');
    const signature = buildCrashSignature({
      parserMetadata,
      grammarKey,
      fileFingerprint,
      stage: resolvedStage,
      exitCode,
      signal
    });
    const existing = eventsBySignature.get(signature);
    if (existing) {
      existing.occurrences += 1;
      existing.lastSeenAt = new Date().toISOString();
      if (taskId) existing.taskIds = Array.from(new Set([...(existing.taskIds || []), taskId]));
    } else {
      const event = {
        schemaVersion: CRASH_BUNDLE_SCHEMA_VERSION,
        signature,
        occurrences: 1,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        stage: resolvedStage,
        grammarKey,
        parser: parserMetadata,
        file: {
          containerPath: firstJob?.containerPath || null,
          virtualPath: firstJob?.virtualPath || null,
          size: fileFingerprint.size,
          mtimeMs: fileFingerprint.mtimeMs,
          fingerprintHash: fileFingerprint.hash
        },
        subprocess: {
          exitCode: Number.isFinite(exitCode) ? exitCode : null,
          signal,
          durationMs: Number.isFinite(Number(error?.result?.durationMs))
            ? Number(error.result.durationMs)
            : null,
          stdoutTail,
          stderrTail
        },
        task: {
          taskGrammarKeys: Array.isArray(taskGrammarKeys) ? taskGrammarKeys.slice() : [],
          inferredFailedGrammarKeys: Array.isArray(inferredFailedGrammarKeys)
            ? inferredFailedGrammarKeys.slice()
            : []
        },
        taskIds: taskId ? [taskId] : [],
        errorMessage: error?.message || String(error),
        subprocessEvents: subprocessCrashEvents
      };
      eventsBySignature.set(signature, event);
      if (typeof log === 'function') {
        log(
          `[tree-sitter:schedule] parser crash contained (${grammarKey}); signature=${signature} ` +
          `stage=${resolvedStage} lang=${parserMetadata.languageId || 'unknown'}`
        );
      }
      if (crashLogger?.enabled) {
        crashLogger.logError({
          category: 'parse',
          phase: 'tree-sitter-scheduler',
          stage: resolvedStage,
          file: firstJob?.containerPath || null,
          languageId: parserMetadata.languageId || null,
          grammarKey,
          signature,
          message: error?.message || String(error),
          parser: parserMetadata,
          subprocess: {
            exitCode: Number.isFinite(exitCode) ? exitCode : null,
            signal
          },
          task: {
            taskGrammarKeys: Array.isArray(taskGrammarKeys) ? taskGrammarKeys.slice() : [],
            inferredFailedGrammarKeys: Array.isArray(inferredFailedGrammarKeys)
              ? inferredFailedGrammarKeys.slice()
              : []
          }
        });
      }
    }
    const bundle = makeBundleSnapshot({
      runtime,
      outDir,
      eventsBySignature,
      failedGrammarKeys,
      degradedVirtualPaths
    });
    void enqueuePersist(bundle);
  };

  return {
    recordFailure,
    getFailedGrammarKeys: () => new Set(failedGrammarKeys),
    getDegradedVirtualPaths: () => new Set(degradedVirtualPaths),
    getBundlePath: () => localBundlePath,
    getDurableBundlePath: () => durableBundlePath,
    summarize: () => ({
      parserCrashSignatures: eventsBySignature.size,
      parserCrashEvents: Array.from(eventsBySignature.values())
        .sort((a, b) => String(a.signature).localeCompare(String(b.signature))),
      failedGrammarKeys: Array.from(failedGrammarKeys).sort(),
      degradedVirtualPaths: Array.from(degradedVirtualPaths).sort()
    }),
    waitForPersistence: async () => {
      try {
        await persistSerial;
      } catch {}
    }
  };
};
