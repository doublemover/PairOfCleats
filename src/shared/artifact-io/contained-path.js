import path from 'node:path';
import { assertNoSymlinkPath } from '../contained-file.js';
import { fromPosix, isAbsolutePathNative, isRelativePathEscape } from '../file-paths.js';

const invalidPath = value => Object.assign(
  new Error(`Artifact path is outside its index root or contains a link: ${value}`),
  { code: 'ERR_ARTIFACT_PATH' }
);

/** Admit producer paths before registering, hashing, or publishing their bytes. */
export const assertArtifactFilePath = (root, target, { allowMissing = false } = {}) => {
  if (typeof root !== 'string' || !root || typeof target !== 'string' || !target) {
    throw invalidPath(target);
  }
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || isAbsolutePathNative(relative) || isRelativePathEscape(relative)) throw invalidPath(target);
  try {
    return assertNoSymlinkPath(resolvedRoot, resolvedTarget, { allowMissing });
  } catch (cause) {
    if (cause?.code === 'ERR_UNSAFE_FILE_PATH') throw Object.assign(invalidPath(target), { cause });
    throw cause;
  }
};

/** Manifest labels are relative identities, never absolute paths or traversal. */
export const resolveArtifactPath = (root, label, options = {}) => {
  if (typeof label !== 'string' || !label || isAbsolutePathNative(label)
    || label.replaceAll('\\', '/').split('/').some(segment => segment === '..')) throw invalidPath(label);
  return assertArtifactFilePath(root, path.resolve(root, fromPosix(label)), options);
};
