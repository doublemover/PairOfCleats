import fs from 'node:fs';
import path from 'node:path';
import { getBakPath } from './cache.js';

export const existsOrBak = (filePath) => fs.existsSync(filePath) || fs.existsSync(getBakPath(filePath));

export const readShardFiles = (dir, prefix) => {
  try {
    const names = fs.readdirSync(dir);
    return names
      .filter((name) => name.startsWith(prefix))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
};

export const resolveArtifactMtime = (filePath) => {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {}
  return 0;
};

export const resolveDirMtime = (dirPath) => {
  try {
    return fs.statSync(dirPath).mtimeMs;
  } catch {}
  return 0;
};
