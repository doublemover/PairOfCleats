import path from 'node:path';
import { toPosix } from '../shared/files.js';
import { toArray } from '../shared/iterables.js';
import { FILE_CATEGORY_RULES } from './constants.js';

export const normalizePath = (value) => toPosix(String(value || ''));

export const basename = (value) => {
  if (!value) return '';
  return normalizePath(path.basename(value));
};

export const extension = (value) => {
  if (!value) return '';
  const ext = path.extname(value);
  return ext || '';
};

export const classifyFilePath = (filePath) => {
  const normalized = normalizePath(filePath || '');
  if (!normalized) return 'other';

  const lower = normalized.toLowerCase();
  const ext = extension(lower);

  const isMatch = (rule) => {
    if (!rule) return false;
    if (rule.extensions && rule.extensions.some((entry) => lower.includes(entry + '.')))
      return true;
    if (rule.extensions && rule.extensions.includes(ext)) return true;
    if (rule.names && rule.names.some((name) => lower.includes('/' + name + '/'))) return true;
    if (rule.patterns && rule.patterns.some((pattern) => pattern.test(lower))) return true;
    return false;
  };

  if (isMatch(FILE_CATEGORY_RULES.generated)) return 'generated';
  if (isMatch(FILE_CATEGORY_RULES.test)) return 'test';
  if (isMatch(FILE_CATEGORY_RULES.docs)) return 'docs';
  if (isMatch(FILE_CATEGORY_RULES.config)) return 'config';
  return 'source';
};

export const sortBy = (list, keyFn) => {
  return list.slice().sort((a, b) => {
    const left = keyFn(a);
    const right = keyFn(b);
    return String(left).localeCompare(String(right));
  });
};

export const unique = (values) => Array.from(new Set(toArray(values).filter(Boolean)));

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
