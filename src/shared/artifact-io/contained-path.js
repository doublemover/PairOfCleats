import path from 'node:path';
import fs from 'node:fs';
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

// Windows 8.3 and verbatim spellings can name the same original directory.
// Admit aliases only after checking every original component, then compare
// canonical physical ancestry. Lexical manifest-label validation stays separate.
const resolveWindowsArtifactAlias = (root, target, { allowMissing }) => {
  if (typeof root !== 'string' || typeof target !== 'string'
    || !path.isAbsolute(root) || !path.isAbsolute(target)) throw invalidPath(target);
  const verifyComponents = (file, missing) => {
    const absolute = path.resolve(file), volume = path.parse(absolute).root;
    const first = absolute.slice(volume.length).split(path.sep).find(Boolean);
    if (!first) throw invalidPath(file);
    // Node's lstat rejects a verbatim volume root; start at its first component.
    assertNoSymlinkPath(path.join(volume, first), absolute, { allowMissing: missing });
  };
  verifyComponents(root, false);
  verifyComponents(target, true);
  if (!fs.lstatSync(root).isDirectory()) throw invalidPath(root);
  const physicalRoot = path.toNamespacedPath(fs.realpathSync.native(root));
  const tail = [];
  let existing = path.resolve(target), physicalTarget, missingError;
  while (true) {
    try { physicalTarget = fs.realpathSync.native(existing); break; }
    catch (error) {
      if (error.code !== 'ENOENT' || path.dirname(existing) === existing) throw error;
      missingError ??= error;
      tail.unshift(path.basename(existing)); existing = path.dirname(existing);
    }
  }
  physicalTarget = path.join(path.toNamespacedPath(physicalTarget), ...tail);
  const relative = path.relative(physicalRoot, physicalTarget);
  if (!relative || isAbsolutePathNative(relative) || isRelativePathEscape(relative)) throw invalidPath(target);
  if (missingError && !allowMissing) throw missingError;
  assertNoSymlinkPath(physicalRoot, physicalTarget, { allowMissing });
  // Keep the caller's root spelling so downstream manifest labels remain
  // relative to that exact root instead of acquiring a namespace prefix.
  return assertNoSymlinkPath(path.resolve(root), path.resolve(root, relative), { allowMissing });
};

/** Admit producer paths before registering, hashing, or publishing their bytes. */
export const assertArtifactFilePath = (root, target, { allowMissing = false } = {}) => {
  try {
    const resolvedTarget = resolveLexicalArtifactFilePath(root, target);
    return assertNoSymlinkPath(path.resolve(root), resolvedTarget, { allowMissing });
  } catch (cause) {
    if (process.platform === 'win32' && ['ERR_ARTIFACT_PATH', 'ERR_UNSAFE_FILE_PATH'].includes(cause?.code)) {
      try { return resolveWindowsArtifactAlias(root, target, { allowMissing }); }
      catch (error) {
        if (error?.code === 'ERR_UNSAFE_FILE_PATH') throw Object.assign(invalidPath(target), { cause: error });
        throw error;
      }
    }
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
