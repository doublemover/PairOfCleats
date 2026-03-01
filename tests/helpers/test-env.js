import { splitNormalizedLines } from '../../src/shared/eol.js';
import {
  getTrackedSubprocessCount,
  terminateTrackedSubprocesses,
  terminateTrackedSubprocessesSync
} from '../../src/shared/subprocess.js';
import { mergeConfig } from '../../src/shared/config.js';
import { resolveDefaultTestConfigLane } from './test-cache.js';

export const DEFAULT_TEST_ENV_KEYS = [
  'PAIROFCLEATS_TESTING',
  'PAIROFCLEATS_CACHE_ROOT',
  'PAIROFCLEATS_EMBEDDINGS',
  'PAIROFCLEATS_TEST_CONFIG'
];

export const TESTING_ENABLED = '1';

const CI_LONG_DEFAULT_TEST_CONFIG = {
  indexing: {
    typeInference: false,
    typeInferenceCrossFile: false,
    riskAnalysis: false,
    riskAnalysisCrossFile: false
  },
  tooling: {
    lsp: {
      enabled: false
    }
  }
};

const resolveLaneDefaultTestConfig = (env) => {
  const lane = resolveDefaultTestConfigLane(env?.PAIROFCLEATS_TEST_LANE);
  if (!lane) return undefined;
  return CI_LONG_DEFAULT_TEST_CONFIG;
};

export const syncProcessEnv = (env, keys = DEFAULT_TEST_ENV_KEYS, { clearMissing = false } = {}) => {
  if (!env || typeof env !== 'object') return;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) {
      if (clearMissing) delete process.env[key];
      continue;
    }
    const value = env[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
};

export const ensureTestingEnv = (env) => {
  if (!env || typeof env !== 'object') return env;
  env.PAIROFCLEATS_TESTING = TESTING_ENABLED;
  return env;
};

/**
 * Temporarily apply environment overrides for the current process while running a callback.
 *
 * @template T
 * @param {Record<string, string|number|boolean|undefined|null>|null} overrides
 * @param {() => Promise<T>|T} callback
 * @returns {Promise<T>}
 */
export const withTemporaryEnv = async (overrides, callback) => {
  if (typeof callback !== 'function') {
    throw new TypeError('withTemporaryEnv callback must be a function');
  }
  if (!overrides || typeof overrides !== 'object') {
    return await callback();
  }
  const restore = [];
  for (const [key, value] of Object.entries(overrides)) {
    const hadKey = Object.prototype.hasOwnProperty.call(process.env, key);
    const previousValue = hadKey ? process.env[key] : undefined;
    const nextValue = value === undefined || value === null ? undefined : String(value);
    if (nextValue === undefined && previousValue === undefined) continue;
    if (nextValue !== undefined && previousValue === nextValue) continue;
    restore.push([key, previousValue]);
    if (nextValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = nextValue;
    }
  }
  try {
    return await callback();
  } finally {
    for (let i = restore.length - 1; i >= 0; i -= 1) {
      const [key, previousValue] = restore[i];
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
};

export const applyTestEnv = ({
  cacheRoot,
  embeddings,
  testing = TESTING_ENABLED,
  testConfig,
  extraEnv,
  syncProcess = true
} = {}) => {
  const env = { ...process.env };
  const laneDefaultTestConfig = resolveLaneDefaultTestConfig(env);
  const deletedKeys = new Set();
  const preservedPairOfCleatsKeys = new Set([
    'PAIROFCLEATS_TEST_API_STARTUP_TIMEOUT_MS',
    'PAIROFCLEATS_TEST_CACHE_SUFFIX',
    'PAIROFCLEATS_TEST_LOG_SILENT',
    'PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY',
    'PAIROFCLEATS_TEST_LANE',
    'PAIROFCLEATS_TEST_ID',
    'PAIROFCLEATS_TESTING'
  ]);
  for (const key of Object.keys(env)) {
    if (!key.startsWith('PAIROFCLEATS_')) continue;
    if (preservedPairOfCleatsKeys.has(key)) continue;
    delete env[key];
    deletedKeys.add(key);
  }
  const removeKey = (key) => {
    delete env[key];
    if (key && key.startsWith('PAIROFCLEATS_')) deletedKeys.add(key);
  };
  if (testing !== undefined && testing !== null) {
    env.PAIROFCLEATS_TESTING = String(testing);
  }
  if (cacheRoot) {
    env.PAIROFCLEATS_CACHE_ROOT = String(cacheRoot);
  }
  if (embeddings !== undefined) {
    if (embeddings === null) {
      removeKey('PAIROFCLEATS_EMBEDDINGS');
    } else {
      env.PAIROFCLEATS_EMBEDDINGS = String(embeddings);
    }
  }
  const effectiveTestConfig = (() => {
    if (testConfig !== undefined) return testConfig;
    return laneDefaultTestConfig;
  })();
  if (effectiveTestConfig === undefined) {
    // Prevent inherited runner/shell overrides from silently mutating test behavior.
    removeKey('PAIROFCLEATS_TEST_CONFIG');
  } else if (effectiveTestConfig === null) {
    removeKey('PAIROFCLEATS_TEST_CONFIG');
  } else if (typeof effectiveTestConfig === 'string') {
    if (!laneDefaultTestConfig) {
      env.PAIROFCLEATS_TEST_CONFIG = effectiveTestConfig;
    } else {
      try {
        const parsed = JSON.parse(effectiveTestConfig);
        env.PAIROFCLEATS_TEST_CONFIG = JSON.stringify(mergeConfig(laneDefaultTestConfig, parsed));
      } catch {
        env.PAIROFCLEATS_TEST_CONFIG = effectiveTestConfig;
      }
    }
  } else {
    env.PAIROFCLEATS_TEST_CONFIG = JSON.stringify(
      laneDefaultTestConfig
        ? mergeConfig(laneDefaultTestConfig, effectiveTestConfig)
        : effectiveTestConfig
    );
  }
  if (extraEnv && typeof extraEnv === 'object') {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value === undefined || value === null) {
        removeKey(key);
      } else {
        env[key] = String(value);
      }
    }
  }
  if (syncProcess) {
    const syncKeys = new Set(DEFAULT_TEST_ENV_KEYS);
    for (const key of Object.keys(env)) {
      if (key.startsWith('PAIROFCLEATS_')) syncKeys.add(key);
    }
    for (const key of deletedKeys) syncKeys.add(key);
    syncProcessEnv(env, Array.from(syncKeys), { clearMissing: true });
  }
  return env;
};

export const shouldLogSilent = () => {
  const value = process.env.PAIROFCLEATS_TEST_LOG_SILENT;
  return value === '1' || value === 'true';
};

export const resolveSilentStdio = (defaultStdio = 'ignore') => (
  shouldLogSilent() ? 'inherit' : defaultStdio
);

let trackedCleanupTriggered = false;

const summarizeTrackedCleanup = (summary) => {
  const attempted = Number(summary?.attempted || 0);
  const failures = Number(summary?.failures || 0);
  return {
    attempted: Number.isFinite(attempted) ? attempted : 0,
    failures: Number.isFinite(failures) ? failures : 0
  };
};

const markTrackedCleanupLeak = (summary, reason, { sync = false } = {}) => {
  const details = summarizeTrackedCleanup(summary);
  if (details.attempted <= 0) return;
  if (details.failures <= 0) return;
  const prefix = sync ? '[test-cleanup][leak-sync]' : '[test-cleanup][leak]';
  process.stderr.write(
    `${prefix} tracked subprocess cleanup failed during ${reason}; attempted=${details.attempted} failures=${details.failures}; failing test process.\n`
  );
  if (!Number.isInteger(process.exitCode) || process.exitCode === 0) {
    process.exitCode = 1;
  }
};

const runTrackedSubprocessCleanup = async (reason) => {
  if (trackedCleanupTriggered) return;
  if (getTrackedSubprocessCount() <= 0) return;
  trackedCleanupTriggered = true;
  try {
    const summary = await terminateTrackedSubprocesses({ reason, force: true });
    markTrackedCleanupLeak(summary, reason);
  } catch {}
};

const runTrackedSubprocessCleanupSync = (reason) => {
  if (trackedCleanupTriggered) return;
  if (getTrackedSubprocessCount() <= 0) return;
  trackedCleanupTriggered = true;
  try {
    const summary = terminateTrackedSubprocessesSync({ reason, force: true });
    markTrackedCleanupLeak(summary, reason, { sync: true });
  } catch {}
};

process.once('beforeExit', () => {
  void runTrackedSubprocessCleanup('test_process_before_exit');
});
process.once('exit', () => {
  runTrackedSubprocessCleanupSync('test_process_exit');
});
process.on('uncaughtExceptionMonitor', () => {
  runTrackedSubprocessCleanupSync('test_uncaught_exception');
});

export const attachSilentLogging = (child, label = null) => {
  if (!shouldLogSilent() || !child) return;
  const prefix = label ? `[${label}] ` : '';
  const forward = (stream) => {
    if (!stream) return;
    stream.on('data', (chunk) => {
      const text = chunk.toString();
      if (!text) return;
      if (!prefix) {
        process.stderr.write(text);
        return;
      }
      const lines = splitNormalizedLines(text);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line && i === lines.length - 1) continue;
        process.stderr.write(`${prefix}${line}\n`);
      }
    });
  };
  forward(child.stdout);
  forward(child.stderr);
};
