import fs from 'node:fs';
import path from 'node:path';

export const toCachePathKey = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return path.resolve(value).replace(/[\\/]+/g, '/');
  } catch {
    return value.replace(/[\\/]+/g, '/');
  }
};

export const readFileStamp = (filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return `${Math.floor(stat.mtimeMs)}:${Math.floor(stat.size)}`;
  } catch {
    return 'missing';
  }
};
