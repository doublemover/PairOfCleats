import { toRepoPosixPath } from '../paths.js';

export const parseJjLines = (value) => (
  String(value || '')
    .split(/\r?\n/)
    .map((entry) => entry)
    .filter(Boolean)
);

export const parseJjNullSeparated = (value) => (
  String(value || '')
    .split('\0')
    .map((entry) => entry)
    .filter(Boolean)
);

export const parseJjJsonLines = (value) => {
  const rows = [];
  for (const line of String(value || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      continue;
    }
  }
  return rows;
};

export const parseJjFileListOutput = ({ output, nullDelimited = false }) => (
  nullDelimited ? parseJjNullSeparated(output) : parseJjLines(output)
);

const normalizeJjScalar = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

export const parseJjBookmarks = (value) => {
  const list = Array.isArray(value)
    ? value
    : String(value || '')
      .replace(/[\[\]]/g, ' ')
      .split(/[\s,]+/);
  const unique = Array.from(new Set(
    list
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
  return unique.length ? unique : null;
};

export const parseJjHeadOutput = ({ logOutput, bookmarksOutput = '' }) => {
  const rows = parseJjJsonLines(logOutput);
  const first = rows[0] && typeof rows[0] === 'object' ? rows[0] : {};
  return {
    commitId: normalizeJjScalar(first.commit_id),
    changeId: normalizeJjScalar(first.change_id),
    author: normalizeJjScalar(first.author),
    timestamp: normalizeJjScalar(first.timestamp),
    bookmarks: parseJjBookmarks(bookmarksOutput)
  };
};

const filterBySubdir = (entries, repoRoot, subdir) => {
  if (!subdir) return entries;
  const scope = toRepoPosixPath(subdir, repoRoot);
  if (!scope) return entries;
  const prefix = scope.endsWith('/') ? scope : `${scope}/`;
  return entries.filter((entry) => entry === scope || entry.startsWith(prefix));
};

export const normalizeJjPathList = ({
  entries,
  repoRoot,
  subdir = null,
  maxCount = null
}) => {
  const normalized = (entries || [])
    .map((entry) => toRepoPosixPath(entry, repoRoot))
    .filter(Boolean);
  const filtered = filterBySubdir(normalized, repoRoot, subdir);
  filtered.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const limit = Number.isFinite(Number(maxCount)) ? Math.max(0, Math.floor(Number(maxCount))) : null;
  if (!limit || filtered.length <= limit) {
    return { filesPosix: filtered, truncated: false };
  }
  return { filesPosix: filtered.slice(0, limit), truncated: true };
};
