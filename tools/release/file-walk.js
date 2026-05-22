import fs from 'node:fs';
import path from 'node:path';

export const toPosixRelative = (baseDir, filePath) => path.relative(baseDir, filePath).replace(/\\/g, '/');

export const resolveRepoContainedPath = (root, value, label = 'path') => {
  const text = String(value || '').trim();
  if (!text) return { ok: true, path: '', relative: '' };
  const resolved = path.resolve(root, text);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return {
      ok: false,
      path: resolved,
      relative: relative.replace(/\\/g, '/'),
      error: `${label} must stay within repo root: ${text}`
    };
  }
  return { ok: true, path: resolved, relative: relative.replace(/\\/g, '/') };
};

const resolveExistingPathPrefix = (root, resolvedPath) => {
  const rootPath = path.resolve(root);
  const relative = path.relative(rootPath, resolvedPath);
  const parts = relative.split(path.sep).filter(Boolean);
  const existing = [];
  let current = rootPath;
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    existing.push(current);
  }
  return existing;
};

export const resolveRepoContainedNoSymlinkPath = (root, value, label = 'path') => {
  const resolution = resolveRepoContainedPath(root, value, label);
  if (!resolution.ok || !resolution.path) return resolution;
  for (const existingPath of resolveExistingPathPrefix(root, resolution.path)) {
    if (fs.lstatSync(existingPath).isSymbolicLink()) {
      return {
        ok: false,
        path: resolution.path,
        relative: resolution.relative,
        error: `${label} must not use symlink path segment: ${toPosixRelative(path.resolve(root), existingPath)}`
      };
    }
  }
  return resolution;
};

export const resolveRepoContainedOutputPath = resolveRepoContainedNoSymlinkPath;

export const requireRepoContainedPath = (root, value, label = 'path') => {
  const resolution = resolveRepoContainedPath(root, value, label);
  if (!resolution.ok) {
    throw new Error(resolution.error);
  }
  return resolution.path;
};

export const requireRepoContainedOutputPath = (root, value, label = 'path') => {
  const resolution = resolveRepoContainedOutputPath(root, value, label);
  if (!resolution.ok) {
    throw new Error(resolution.error);
  }
  return resolution.path;
};

export const collectSortedFiles = (dirPath) => {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  const baseDir = path.resolve(dirPath);
  if (fs.lstatSync(baseDir).isSymbolicLink()) {
    throw new Error(`release file walk rejects symlink root: ${toPosixRelative(path.dirname(baseDir), baseDir)}`);
  }
  const files = [];
  const stack = [baseDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(resolved);
        continue;
      }
      if (entry.isSymbolicLink()) {
        throw new Error(`release file walk rejects symlink entries: ${toPosixRelative(baseDir, resolved)}`);
      }
      files.push(resolved);
    }
  }
  return files.sort((a, b) => {
    const left = toPosixRelative(baseDir, a);
    const right = toPosixRelative(baseDir, b);
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
};
