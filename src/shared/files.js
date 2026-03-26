export {
  fileExt,
  toPosix,
  isPathWithinRoot,
  isRootPath,
  fromPosix,
  isAbsolutePath,
  isAbsolutePathNative,
  isRelativePathEscape,
  isAbsolutePathAny,
  isUncPath
} from './file-paths.js';

export {
  readFileRangeSync,
  pathExists,
  readJsonFileSafe,
  readJsonFileSyncSafe,
  readJsonLinesSyncSafe
} from './file-read.js';
