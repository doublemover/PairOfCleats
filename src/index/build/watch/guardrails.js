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

export const resolveMaxFilesCap = (maxFiles) => {
  const cap = Number(maxFiles);
  return Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : null;
};

export const resolveMaxDepthCap = (maxDepth) => {
  const cap = Number(maxDepth);
  return Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : null;
};

export const isIndexablePath = ({ absPath, root, recordsRoot, ignoreMatcher, modes }) => {
  const relPosix = toPosix(path.relative(root, absPath));
  if (!relPosix || relPosix === '.' || relPosix.startsWith('..')) return false;
  const normalizedRecordsRoot = recordsRoot ? normalizeRoot(recordsRoot) : null;
  if (normalizedRecordsRoot) {
    const normalizedAbs = normalizeRoot(absPath);
    if (normalizedAbs.startsWith(`${normalizedRecordsRoot}${path.sep}`)) {
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
