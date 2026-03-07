import fsSync from 'node:fs';
import path from 'node:path';
import { resolveEnvPath } from '../../shared/env-path.js';

export const candidateNames = (name) => {
  if (process.platform === 'win32') {
    return [`${name}.cmd`, `${name}.exe`, name];
  }
  return [name];
};

export const findBinaryInDirs = (name, dirs = []) => {
  const candidates = candidateNames(name);
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (fsSync.existsSync(full)) return full;
    }
  }
  return null;
};

export const splitPathEntries = (envPath = resolveEnvPath(process.env)) => (
  String(envPath || '')
    .split(path.delimiter)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
);

export const findBinaryOnPath = (name, envPath = resolveEnvPath(process.env)) => (
  findBinaryInDirs(name, splitPathEntries(envPath))
);
