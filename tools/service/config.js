import fs from 'node:fs';
import path from 'node:path';
import { getCacheRoot } from '../dict-utils.js';

export function getServiceConfigPath(inputPath = null) {
  if (inputPath) return path.resolve(inputPath);
  return path.join(getCacheRoot(), 'service', 'config.json');
}

export function loadServiceConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    return {
      repos: [],
      queue: {
        maxQueued: 20
      },
      worker: {
        concurrency: 1
      },
      embeddings: {
        queue: {
          maxQueued: 10
        },
        worker: {
          concurrency: 1,
          maxMemoryMb: 4096
        }
      },
      sync: {
        policy: 'pull',
        intervalMs: 5 * 60 * 1000
      }
    };
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return raw && typeof raw === 'object' ? raw : {};
}

export function resolveRepoRegistry(config, configPath) {
  if (Array.isArray(config?.repos)) return config.repos;
  const repoFile = config?.reposFile;
  if (!repoFile) return [];
  const baseDir = configPath ? path.dirname(configPath) : process.cwd();
  const resolved = path.isAbsolute(repoFile) ? repoFile : path.join(baseDir, repoFile);
  if (!fs.existsSync(resolved)) return [];
  const payload = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return Array.isArray(payload?.repos) ? payload.repos : [];
}
