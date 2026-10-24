import path from 'node:path';
import { assertNoSymlinkPath } from '../contained-file.js';
import { fromPosix, isAbsolutePathNative, isRelativePathEscape } from '../file-paths.js';

const invalidPath = value => Object.assign(
  new Error(`Artifact path is outside its index root or contains a link: ${value}`),
  { code: 'ERR_ARTIFACT_PATH' }
);

const resolveLexicalArtifactFilePath = (root, target) => {
  if (typeof root !== 'string' || !root || typeof target !== 'string' || !target) {
    throw invalidPath(target);
  }
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || isAbsolutePathNative(relative) || isRelativePathEscape(relative)) throw invalidPath(target);
  return resolvedTarget;
};

/** Admit producer paths before registering, hashing, or publishing their bytes. */
export const assertArtifactFilePath = (root, target, { allowMissing = false } = {}) => {
  const resolvedTarget = resolveLexicalArtifactFilePath(root, target);
  try {
    return assertNoSymlinkPath(path.resolve(root), resolvedTarget, { allowMissing });
  } catch (cause) {
    if (cause?.code === 'ERR_UNSAFE_FILE_PATH') throw Object.assign(invalidPath(target), { cause });
    throw cause;
  }
};

// Identity comparisons need lexical containment only. This does not admit file
// access: actual reads, stats and publication still use resolveArtifactPath.
export const resolveArtifactIdentityPath = (root, label) => {
  if (typeof label !== 'string' || !label || isAbsolutePathNative(label)
    || label.replaceAll('\\', '/').split('/').some(segment => segment === '..')) throw invalidPath(label);
  return resolveLexicalArtifactFilePath(root, path.resolve(root, fromPosix(label)));
};

/** Manifest labels are relative identities; admit the physical file at use. */
export const resolveArtifactPath = (root, label, options = {}) =>
  assertArtifactFilePath(root, resolveArtifactIdentityPath(root, label), options);
