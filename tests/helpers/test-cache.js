import fsPromises from 'node:fs/promises';
import path from 'node:path';

export const resolveTestCacheDir = (name, { root = process.cwd() } = {}) => {
  const label = typeof name === 'string' && name.trim() ? name.trim() : 'default';
  return {
    root,
    dir: path.join(root, '.testCache', label)
  };
};

export const resolveTestCachePath = (root = process.cwd(), ...segments) => (
  path.join(root, '.testCache', ...segments)
);

export const prepareTestCacheDir = async (name, { clean = true, root = process.cwd() } = {}) => {
  const resolved = resolveTestCacheDir(name, { root });
  if (clean) {
    await fsPromises.rm(resolved.dir, { recursive: true, force: true });
  }
  await fsPromises.mkdir(resolved.dir, { recursive: true });
  return resolved;
};
