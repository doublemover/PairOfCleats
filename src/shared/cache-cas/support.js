import fs from 'node:fs';
import { readJsonFileSafe } from '../file-read.js';

const CAS_JSON_MAX_BYTES = 2 * 1024 * 1024;

export const CAS_ENUM_CONCURRENCY = 16;

export const toIsoString = (value = Date.now()) => {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return new Date().toISOString();
};

export const fileExists = (targetPath) => {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
};

export const readJsonIfExists = async (targetPath) => {
  if (!fileExists(targetPath)) return null;
  const parsed = await readJsonFileSafe(targetPath, {
    fallback: null,
    maxBytes: CAS_JSON_MAX_BYTES
  });
  return parsed && typeof parsed === 'object' ? parsed : null;
};

export const runWithConcurrency = async (items, maxConcurrency, worker) => {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const limit = Math.max(1, Math.floor(Number(maxConcurrency) || 1));
  const output = new Array(list.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= list.length) return;
      output[current] = await worker(list[current], current);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => runWorker()));
  return output;
};
