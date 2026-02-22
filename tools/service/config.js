import fs from 'node:fs';
import path from 'node:path';
import { getCacheRoot } from '../shared/dict-utils.js';
import { isAbsolutePathNative } from '../../src/shared/files.js';

export const DEFAULT_SERVICE_CONFIG = Object.freeze({
  repos: [],
  queue: {
    maxQueued: 20,
    maxRetries: 2
  },
  worker: {
    concurrency: 1
  },
  embeddings: {
    queue: {
      maxQueued: 10,
      maxRetries: 2
    },
    worker: {
      concurrency: 1,
      maxMemoryMb: 4096
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

export function getServiceConfigPath(inputPath = null) {
  if (inputPath) return path.resolve(inputPath);
  return path.join(getCacheRoot(), 'service', 'config.json');
}

export function loadServiceConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    return JSON.parse(JSON.stringify(DEFAULT_SERVICE_CONFIG));
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const payload = raw && typeof raw === 'object' ? raw : {};
  return {
    ...JSON.parse(JSON.stringify(DEFAULT_SERVICE_CONFIG)),
    ...payload,
    queue: {
      ...DEFAULT_SERVICE_CONFIG.queue,
      ...(payload.queue && typeof payload.queue === 'object' ? payload.queue : {})
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
          : {})
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
