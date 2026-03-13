import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonFileSafe } from '../../../shared/files.js';
import { atomicWriteJson } from '../../../shared/io/atomic-write.js';

const WORKSPACE_COMMAND_PREFLIGHT_CACHE_SCHEMA_VERSION = 1;
const WORKSPACE_COMMAND_PREFLIGHT_MARKER_MAX_BYTES = 64 * 1024;

const normalizeRepoHash = (repoRoot) => crypto
  .createHash('sha1')
  .update(path.resolve(String(repoRoot || '')).toLowerCase())
  .digest('hex');

const sanitizeNamespace = (value) => (
  String(value || 'workspace-command')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'workspace-command'
);

const normalizeExtraFingerprint = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [String(key), entry])
      .sort((left, right) => left[0].localeCompare(right[0]))
  );
};

const normalizeWatchedFileEntry = (value) => {
  if (typeof value === 'string') {
    const filePath = String(value || '').trim();
    return filePath ? { path: filePath, mode: 'stat' } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const filePath = String(value.path || '').trim();
  if (!filePath) return null;
  const mode = String(value.mode || 'stat').trim().toLowerCase() === 'content'
    ? 'content'
    : 'stat';
  return { path: filePath, mode };
};

const toRelativeFingerprintPath = (repoRoot, targetPath) => {
  const resolvedRoot = path.resolve(String(repoRoot || ''));
  const resolvedTarget = path.resolve(String(targetPath || ''));
  const relativePath = path.relative(resolvedRoot, resolvedTarget);
  return relativePath.replace(/\\/g, '/');
};

const buildFileDigest = async ({ filePath, mode }) => {
  try {
    const stat = await fs.stat(filePath);
    if (mode !== 'content') {
      return `stat:${Number.isFinite(stat.size) ? stat.size : 0}:${Number.isFinite(stat.mtimeMs) ? Math.floor(stat.mtimeMs) : 0}`;
    }
    const data = await fs.readFile(filePath);
    return `content:${crypto.createHash('sha1').update(data).digest('hex')}`;
  } catch (error) {
    if (error?.code === 'ENOENT') return '<missing>';
    return `<error:${String(error?.code || 'stat_failed')}>`;
  }
};

export const resolveWorkspaceCommandPreflightMarkerPath = ({
  repoRoot,
  cacheRoot = null,
  namespace
} = {}) => {
  const safeNamespace = sanitizeNamespace(namespace);
  if (typeof cacheRoot === 'string' && cacheRoot.trim()) {
    return path.join(
      path.resolve(cacheRoot),
      'tooling',
      'workspace-preflight',
      normalizeRepoHash(repoRoot),
      `${safeNamespace}.json`
    );
  }
  return path.join(
    path.resolve(String(repoRoot || process.cwd())),
    '.build',
    'pairofcleats',
    'workspace-preflight',
    `${safeNamespace}.json`
  );
};

export const buildWorkspaceCommandPreflightFingerprint = async ({
  repoRoot,
  command,
  args,
  watchedFiles = [],
  extra = null
} = {}) => {
  const hash = crypto.createHash('sha1');
  hash.update(`schema:${WORKSPACE_COMMAND_PREFLIGHT_CACHE_SCHEMA_VERSION}`);
  hash.update(`command:${String(command || '').trim()}`);
  hash.update(`args:${JSON.stringify(Array.isArray(args) ? args.map((entry) => String(entry)) : [])}`);
  const files = Array.isArray(watchedFiles)
    ? watchedFiles
      .map((entry) => normalizeWatchedFileEntry(entry))
      .filter(Boolean)
      .map((entry) => ({ ...entry, path: path.resolve(entry.path) }))
      .sort((left, right) => left.path.localeCompare(right.path))
    : [];
  for (const entry of files) {
    hash.update(`file:${toRelativeFingerprintPath(repoRoot, entry.path)}`);
    hash.update(`mode:${entry.mode}`);
    hash.update(`digest:${await buildFileDigest({ filePath: entry.path, mode: entry.mode })}`);
  }
  const normalizedExtra = normalizeExtraFingerprint(extra);
  if (normalizedExtra) {
    hash.update(`extra:${JSON.stringify(normalizedExtra)}`);
  }
  return hash.digest('hex');
};

export const readWorkspaceCommandPreflightCacheHit = async ({
  repoRoot,
  cacheRoot = null,
  namespace,
  fingerprint
} = {}) => {
  const markerPath = resolveWorkspaceCommandPreflightMarkerPath({
    repoRoot,
    cacheRoot,
    namespace
  });
  const marker = await readJsonFileSafe(markerPath, {
    fallback: null,
    maxBytes: WORKSPACE_COMMAND_PREFLIGHT_MARKER_MAX_BYTES
  });
  if (!marker || typeof marker !== 'object') {
    return { markerPath, hit: false };
  }
  if (Number(marker.schemaVersion) !== WORKSPACE_COMMAND_PREFLIGHT_CACHE_SCHEMA_VERSION) {
    return { markerPath, hit: false };
  }
  if (String(marker.fingerprint || '') !== String(fingerprint || '')) {
    return { markerPath, hit: false };
  }
  return { markerPath, hit: true, marker };
};

export const writeWorkspaceCommandPreflightCacheMarker = async ({
  repoRoot,
  cacheRoot = null,
  namespace,
  fingerprint,
  command,
  args,
  durationMs
} = {}) => {
  const markerPath = resolveWorkspaceCommandPreflightMarkerPath({
    repoRoot,
    cacheRoot,
    namespace
  });
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  await atomicWriteJson(markerPath, {
    schemaVersion: WORKSPACE_COMMAND_PREFLIGHT_CACHE_SCHEMA_VERSION,
    completedAt: new Date().toISOString(),
    fingerprint: String(fingerprint || ''),
    command: {
      cmd: String(command || ''),
      args: Array.isArray(args) ? args.map((entry) => String(entry)) : []
    },
    durationMs: Number.isFinite(Number(durationMs))
      ? Math.max(0, Math.round(Number(durationMs)))
      : null
  }, {
    spaces: 0,
    newline: false
  });
  return markerPath;
};
