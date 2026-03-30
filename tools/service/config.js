import fs from 'node:fs';
import path from 'node:path';
import { getCacheRoot } from '../shared/dict-utils.js';
import { isAbsolutePathNative } from '../../src/shared/files.js';
import { QUEUE_RETENTION_DEFAULTS } from './retention-policy.js';

export const DEFAULT_SERVICE_CONFIG = Object.freeze({
  repos: [],
  queue: {
    maxQueued: 20,
    maxRetries: 2,
    maxRunning: 1,
    maxTotal: 21,
    resourceBudgetUnits: 4,
    retention: {
      ...QUEUE_RETENTION_DEFAULTS
    }
  },
  worker: {
    concurrency: 1,
    shutdownTimeoutMs: 10000
  },
  embeddings: {
    queue: {
      maxQueued: 10,
      maxRetries: 2,
      maxRunning: 1,
      maxTotal: 11,
      resourceBudgetUnits: 8,
      retention: {
        ...QUEUE_RETENTION_DEFAULTS
      }
    },
    worker: {
      concurrency: 1,
      maxMemoryMb: 4096,
      shutdownTimeoutMs: 10000
    }
  },
  sync: {
    policy: 'pull',
    intervalMs: 5 * 60 * 1000
  },
  security: {
    allowShell: false,
    allowPathEscape: false
  }
});

const cloneDefaultServiceConfig = () => JSON.parse(JSON.stringify(DEFAULT_SERVICE_CONFIG));

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const SERVICE_SYNC_POLICIES = new Set(['pull', 'fetch', 'none']);

const createServiceConfigError = (message, {
  configPath = null,
  path: fieldPath = null,
  hint = null,
  value = undefined
} = {}) => {
  const parts = [];
  if (configPath) parts.push(configPath);
  if (fieldPath) parts.push(fieldPath);
  const location = parts.length ? ` (${parts.join(' :: ')})` : '';
  const renderedValue = value === undefined ? '' : ` Received: ${JSON.stringify(value)}.`;
  const err = new Error(`[service-config] ${message}${location}.${renderedValue}`);
  err.code = 'INVALID_REQUEST';
  err.hint = hint || 'Fix the service config shape/value and retry.';
  err.configPath = configPath || null;
  err.fieldPath = fieldPath || null;
  return err;
};

const assertObject = (value, label, configPath) => {
  if (value == null) return;
  if (!isPlainObject(value)) {
    throw createServiceConfigError(`${label} must be a JSON object`, {
      configPath,
      path: label,
      value
    });
  }
};

const assertString = (value, label, configPath, { allowEmpty = false } = {}) => {
  if (value == null) return;
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw createServiceConfigError(`${label} must be a non-empty string`, {
      configPath,
      path: label,
      value
    });
  }
};

const assertBoolean = (value, label, configPath) => {
  if (value == null) return;
  if (typeof value !== 'boolean') {
    throw createServiceConfigError(`${label} must be a boolean`, {
      configPath,
      path: label,
      value
    });
  }
};

const assertNonNegativeInteger = (value, label, configPath, { min = 0 } = {}) => {
  if (value == null) return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.floor(parsed) !== parsed || parsed < min) {
    throw createServiceConfigError(`${label} must be an integer >= ${min}`, {
      configPath,
      path: label,
      value
    });
  }
};

const assertPolicy = (value, label, configPath, allowedValues) => {
  if (value == null) return;
  if (typeof value !== 'string' || !allowedValues.has(value.trim().toLowerCase())) {
    throw createServiceConfigError(
      `${label} must be one of: ${Array.from(allowedValues).sort((a, b) => a.localeCompare(b)).join(', ')}`,
      {
        configPath,
        path: label,
        value
      }
    );
  }
};

const validateQueueConfig = (queueConfig, label, configPath) => {
  assertObject(queueConfig, label, configPath);
  if (!isPlainObject(queueConfig)) return;
  assertNonNegativeInteger(queueConfig.maxQueued, `${label}.maxQueued`, configPath);
  assertNonNegativeInteger(queueConfig.maxRetries, `${label}.maxRetries`, configPath);
  assertNonNegativeInteger(queueConfig.maxRunning, `${label}.maxRunning`, configPath);
  assertNonNegativeInteger(queueConfig.maxTotal, `${label}.maxTotal`, configPath);
  assertNonNegativeInteger(queueConfig.resourceBudgetUnits, `${label}.resourceBudgetUnits`, configPath);
  assertObject(queueConfig.retention, `${label}.retention`, configPath);
};

const validateWorkerConfig = (workerConfig, label, configPath, { allowMaxMemoryMb = false } = {}) => {
  assertObject(workerConfig, label, configPath);
  if (!isPlainObject(workerConfig)) return;
  assertNonNegativeInteger(workerConfig.concurrency, `${label}.concurrency`, configPath);
  assertNonNegativeInteger(workerConfig.shutdownTimeoutMs, `${label}.shutdownTimeoutMs`, configPath, { min: 250 });
  if (allowMaxMemoryMb) {
    assertNonNegativeInteger(workerConfig.maxMemoryMb, `${label}.maxMemoryMb`, configPath, { min: 128 });
  }
};

export function validateServiceConfig(config, configPath = null) {
  if (!isPlainObject(config)) {
    throw createServiceConfigError('service config root must be a JSON object', {
      configPath,
      value: config
    });
  }

  if (config.baseDir != null) assertString(config.baseDir, 'baseDir', configPath);
  if (config.queueDir != null) assertString(config.queueDir, 'queueDir', configPath);
  if (config.reposFile != null) assertString(config.reposFile, 'reposFile', configPath);

  if (config.repos != null) {
    if (!Array.isArray(config.repos)) {
      throw createServiceConfigError('repos must be an array', {
        configPath,
        path: 'repos',
        value: config.repos
      });
    }
    for (let index = 0; index < config.repos.length; index += 1) {
      const entry = config.repos[index];
      const prefix = `repos[${index}]`;
      assertObject(entry, prefix, configPath);
      if (!isPlainObject(entry)) continue;
      assertString(entry.id, `${prefix}.id`, configPath);
      assertString(entry.path, `${prefix}.path`, configPath);
      assertString(entry.url, `${prefix}.url`, configPath);
      assertString(entry.branch, `${prefix}.branch`, configPath);
      assertPolicy(entry.syncPolicy, `${prefix}.syncPolicy`, configPath, SERVICE_SYNC_POLICIES);
      assertNonNegativeInteger(entry.cloneDepth, `${prefix}.cloneDepth`, configPath);
    }
  }

  validateQueueConfig(config.queue, 'queue', configPath);
  validateWorkerConfig(config.worker, 'worker', configPath);
  assertObject(config.embeddings, 'embeddings', configPath);
  if (isPlainObject(config.embeddings)) {
    validateQueueConfig(config.embeddings.queue, 'embeddings.queue', configPath);
    validateWorkerConfig(config.embeddings.worker, 'embeddings.worker', configPath, { allowMaxMemoryMb: true });
  }
  assertObject(config.sync, 'sync', configPath);
  if (isPlainObject(config.sync)) {
    assertPolicy(config.sync.policy, 'sync.policy', configPath, SERVICE_SYNC_POLICIES);
    assertNonNegativeInteger(config.sync.intervalMs, 'sync.intervalMs', configPath);
  }
  assertObject(config.security, 'security', configPath);
  if (isPlainObject(config.security)) {
    assertBoolean(config.security.allowShell, 'security.allowShell', configPath);
    assertBoolean(config.security.allowPathEscape, 'security.allowPathEscape', configPath);
  }
}

export function getServiceConfigPath(inputPath = null) {
  if (inputPath) return path.resolve(inputPath);
  return path.join(getCacheRoot(), 'service', 'config.json');
}

export function loadServiceConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    return cloneDefaultServiceConfig();
  }
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw createServiceConfigError(`failed to parse service config: ${error?.message || error}`, {
      configPath,
      hint: 'Fix the JSON syntax in the service config and retry.'
    });
  }
  const payload = raw;
  validateServiceConfig(payload, configPath);
  return {
    ...cloneDefaultServiceConfig(),
    ...payload,
    queue: {
      ...DEFAULT_SERVICE_CONFIG.queue,
      ...(payload.queue && typeof payload.queue === 'object' ? payload.queue : {}),
      retention: {
        ...DEFAULT_SERVICE_CONFIG.queue.retention,
        ...(payload.queue?.retention && typeof payload.queue.retention === 'object'
          ? payload.queue.retention
          : {})
      }
    },
    worker: {
      ...DEFAULT_SERVICE_CONFIG.worker,
      ...(payload.worker && typeof payload.worker === 'object' ? payload.worker : {})
    },
    embeddings: {
      ...DEFAULT_SERVICE_CONFIG.embeddings,
      ...(payload.embeddings && typeof payload.embeddings === 'object' ? payload.embeddings : {}),
      queue: {
        ...DEFAULT_SERVICE_CONFIG.embeddings.queue,
        ...(payload.embeddings?.queue && typeof payload.embeddings.queue === 'object'
          ? payload.embeddings.queue
          : {}),
        retention: {
          ...DEFAULT_SERVICE_CONFIG.embeddings.queue.retention,
          ...(payload.embeddings?.queue?.retention && typeof payload.embeddings.queue.retention === 'object'
            ? payload.embeddings.queue.retention
            : {})
        }
      },
      worker: {
        ...DEFAULT_SERVICE_CONFIG.embeddings.worker,
        ...(payload.embeddings?.worker && typeof payload.embeddings.worker === 'object'
          ? payload.embeddings.worker
          : {})
      }
    },
    sync: {
      ...DEFAULT_SERVICE_CONFIG.sync,
      ...(payload.sync && typeof payload.sync === 'object' ? payload.sync : {})
    },
    security: {
      ...DEFAULT_SERVICE_CONFIG.security,
      ...(payload.security && typeof payload.security === 'object' ? payload.security : {})
    }
  };
}

export function resolveRepoRegistry(config, configPath) {
  if (Array.isArray(config?.repos)) return config.repos;
  const repoFile = config?.reposFile;
  if (!repoFile) return [];
  const baseDir = configPath ? path.dirname(configPath) : process.cwd();
  const resolved = isAbsolutePathNative(repoFile) ? repoFile : path.join(baseDir, repoFile);
  if (!fs.existsSync(resolved)) return [];
  const payload = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return Array.isArray(payload?.repos) ? payload.repos : [];
}
