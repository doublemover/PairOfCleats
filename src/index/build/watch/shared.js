import path from 'node:path';

export const MINIFIED_NAME_REGEX = /(?:\.min\.[^/]+$)|(?:-min\.[^/]+$)/i;

export const normalizeRoot = (value) => {
  const resolved = path.resolve(value || '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
