import path from 'node:path';
import { isRelativePathEscape, toPosix } from '../files.js';

export const buildIgnoredMatcher = ({ root, ignoreMatcher }) => (targetPath, stats) => {
  const relPosix = toPosix(path.relative(root, targetPath));
  if (!relPosix || relPosix === '.' || isRelativePathEscape(relPosix)) return false;
  const isDirectory = stats?.isDirectory ? stats.isDirectory() : null;
  const dirPath = relPosix.endsWith('/') ? relPosix : `${relPosix}/`;
  if (isDirectory === true) {
    if (ignoreMatcher.ignores(dirPath)) return true;
  } else if (isDirectory == null) {
    if (ignoreMatcher.ignores(dirPath)) return true;
  }
  return ignoreMatcher.ignores(relPosix);
};
