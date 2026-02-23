import path from 'node:path';
import {
  isLockFile,
  isManifestFile,
  isSpecialCodeFile,
  resolveSpecialCodeExt
} from '../../constants.js';
import { fileExt, toPosix } from '../../../shared/files.js';
import { pickMinLimit, resolveFileCaps } from '../file-processor/read.js';
import { normalizeRoot } from './shared.js';
import { isCodeEntryForPath, isProseEntryForPath } from '../mode-routing.js';
import { isWithinRoot, toRealPathSync } from '../../../workspace/identity.js';

export const resolveMaxFilesCap = (maxFiles) => {
  const cap = Number(maxFiles);
  return Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : null;
};

export const resolveMaxDepthCap = (maxDepth) => {
  const cap = Number(maxDepth);
  return Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : null;
};

export const isIndexablePath = ({ absPath, root, recordsRoot, ignoreMatcher, modes }) => {
  const canonicalRoot = toRealPathSync(root);
  const canonicalAbs = toRealPathSync(absPath);
  if (!isWithinRoot(canonicalAbs, canonicalRoot)) return false;
  const relPosix = toPosix(path.relative(root, absPath));
  if (!relPosix || relPosix === '.' || relPosix.startsWith('..')) return false;
  const normalizedRecordsRoot = recordsRoot ? toRealPathSync(recordsRoot) : null;
  if (normalizedRecordsRoot) {
    if (isWithinRoot(canonicalAbs, normalizedRecordsRoot)) {
      return modes.includes('records');
    }
  }
  if (ignoreMatcher?.ignores(relPosix)) return false;
  const baseName = path.basename(absPath);
  const ext = resolveSpecialCodeExt(baseName) || fileExt(absPath);
  const isManifest = isManifestFile(baseName);
  const isLock = isLockFile(baseName);
  const isSpecial = isSpecialCodeFile(baseName) || isManifest || isLock;
  const allowCode = (modes.includes('code') || modes.includes('extracted-prose'))
    && isCodeEntryForPath({ ext, relPath: relPosix, isSpecial });
  const allowProse = (modes.includes('prose') || modes.includes('extracted-prose'))
    && isProseEntryForPath({ ext, relPath: relPosix });
  return allowCode || allowProse;
};

export const resolveMaxBytesForFile = (ext, languageId, maxFileBytes, fileCaps) => {
  const caps = resolveFileCaps(fileCaps, ext, languageId, null);
  return pickMinLimit(maxFileBytes, caps.maxBytes);
};
