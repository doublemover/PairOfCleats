import path from 'node:path';
import { toPosix } from '../../../../shared/files.js';
import { toRepoPosixPath } from '../../paths.js';

/**
 * Stable lexical comparator used for deterministic file ordering.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export const compareLexicographically = (left, right) => (
  left < right ? -1 : left > right ? 1 : 0
);

/**
 * Parse NUL-delimited `git -z` output.
 * @param {string} value
 * @returns {string[]}
 */
export const parseNullSeparated = (value) => (
  String(value || '')
    .split('\0')
    .filter(Boolean)
);

/**
 * Parse newline-delimited command output.
 * @param {string} value
 * @returns {string[]}
 */
export const parseLines = (value) => (
  String(value || '')
    .split(/\r?\n/)
    .filter(Boolean)
);

/**
 * Normalize SCM paths to repo-relative posix and return sorted output.
 * @param {string[]} entries
 * @param {string} repoRoot
 * @returns {string[]}
 */
export const toSortedRepoPosixFiles = (entries, repoRoot) => {
  const filesPosix = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const normalized = toRepoPosixPath(toPosix(entry), repoRoot);
    if (!normalized) continue;
    filesPosix.push(normalized);
  }
  filesPosix.sort(compareLexicographically);
  return filesPosix;
};

/**
 * Parse command stdout into normalized file list.
 * @param {{stdout:string,repoRoot:string,parser:(value:string)=>string[]}} input
 * @returns {string[]}
 */
export const parseProviderFileList = ({ stdout, repoRoot, parser }) => (
  toSortedRepoPosixFiles(parser(stdout), repoRoot)
);

/**
 * Append repo-scoped path filter argument (`-- <subdir>`) when provided.
 * @param {string[]} args
 * @param {{repoRoot:string,subdir?:string|null}} input
 * @returns {string[]}
 */
export const appendScopedSubdirArg = (args, { repoRoot, subdir = null }) => {
  const scoped = subdir ? toRepoPosixPath(subdir, repoRoot) : null;
  if (scoped) args.push('--', scoped);
  return args;
};

/**
 * Append optional diff ref range arguments.
 * @param {string[]} args
 * @param {{fromRef?:string|null,toRef?:string|null}} input
 * @returns {string[]}
 */
export const appendDiffRefArgs = (args, { fromRef = null, toRef = null }) => {
  if (fromRef && toRef) {
    args.push(fromRef, toRef);
  } else if (fromRef) {
    args.push(fromRef);
  } else if (toRef) {
    args.push(toRef);
  }
  return args;
};

export const normalizeRepoRootKey = (repoRoot) => {
  const resolved = path.resolve(String(repoRoot || process.cwd()));
  return process.platform === 'win32'
    ? resolved.toLowerCase()
    : resolved;
};

export const buildMetaPathScopeKey = (repoRoot, filePosix) => (
  `${normalizeRepoRootKey(repoRoot)}::${toPosix(filePosix)}`
);
