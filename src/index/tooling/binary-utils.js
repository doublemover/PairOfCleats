import fsSync from 'node:fs';
import path from 'node:path';

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

export const splitPathEntries = (envPath = process.env.PATH || '') => (
  String(envPath || '')
    .split(path.delimiter)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
);

export const findBinaryOnPath = (name, envPath = process.env.PATH || '') => (
  findBinaryInDirs(name, splitPathEntries(envPath))
);
