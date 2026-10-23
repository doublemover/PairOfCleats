import { withGeneratedCacheMetadata, withoutGeneratedCacheMetadata } from '../../../shared/generated-artifact-cache.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonFileSafe } from '../../../shared/file-read.js';
import { writeToolingCacheJson } from '../cache-storage.js';
import { readVerifiedContainedFile, assertNoSymlinkPath } from '../../../shared/contained-file.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { findBinaryOnPath } from '../binary-utils.js';
import { createCommandProbeEnvironmentIdentity } from '../command-probe-persistent-cache.js';

const WORKSPACE_COMMAND_PREFLIGHT_CACHE_SCHEMA_VERSION = 3;
const WORKSPACE_COMMAND_PREFLIGHT_MARKER_MAX_BYTES = 64 * 1024;
const WORKSPACE_COMMAND_PREFLIGHT_INPUT_MAX_BYTES = 2 * 1024 * 1024;
const WORKSPACE_COMMAND_PREFLIGHT_MARKER_MEMORY_CACHE = new Map();

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

const buildFileDigest = async ({ repoRoot, filePath, mode, signal }) => {
  throwIfAborted(signal);
  try {
    assertNoSymlinkPath(repoRoot, filePath);
    const stat = await fs.stat(filePath);
    throwIfAborted(signal);
    if (!stat.isFile()) throw new Error('Workspace preflight input must be a regular contained file.');
    if (mode !== 'content') {
      return `stat:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    }
    const data = (await readVerifiedContainedFile(repoRoot, filePath, {
      maxBytes: WORKSPACE_COMMAND_PREFLIGHT_INPUT_MAX_BYTES, signal
    })).buffer;
    return `content:${crypto.createHash('sha1').update(data).digest('hex')}`;
  } catch (error) {
    if (error?.code === 'ENOENT') return '<missing>';
    throw error;
  }
};

const commandStatIdentity = async command => {
  const filename = findBinaryOnPath(command) || command;
  try {
    const stat = await fs.stat(filename, { bigint: true });
    if (!stat.isFile()) throw new Error('Workspace preflight command is not a regular file.');
    return `${path.resolve(filename)}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch (error) {
    if (error.code === 'ENOENT') return '<missing>';
    throw error;
  }
};

const resolveMarkerStateMaxAgeMs = (cacheMaxAgeMsByState, state) => {
  const normalizedState = String(state || '').trim().toLowerCase() || 'ready';
  const maxAgeMs = Number(cacheMaxAgeMsByState?.[normalizedState]);
  return Number.isFinite(maxAgeMs) && maxAgeMs >= 0
    ? maxAgeMs
    : normalizedState === 'ready' ? 5 * 60_000 : 15_000;
};

const isMarkerFreshForState = (marker, cacheMaxAgeMsByState) => {
  const state = String(marker?.state || '').trim().toLowerCase() || 'ready';
  const maxAgeMs = resolveMarkerStateMaxAgeMs(cacheMaxAgeMsByState, state);
  if (!Number.isFinite(maxAgeMs)) return true;
  const completedAtMs = Date.parse(String(marker?.completedAt || ''));
  if (!Number.isFinite(completedAtMs)) return false;
  return (Date.now() - completedAtMs) <= maxAgeMs;
};

const isReusableWorkspaceCommandPreflightMarker = ({
  marker,
  fingerprint,
  cacheMaxAgeMsByState
} = {}) => {
  if (!marker || typeof marker !== 'object') return false;
  if (Number(marker.schemaVersion) !== WORKSPACE_COMMAND_PREFLIGHT_CACHE_SCHEMA_VERSION) {
    return false;
  }
  if (!['ready', 'degraded'].includes(marker.state)
    || !Number.isFinite(Date.parse(marker.completedAt))
    || !marker.command || typeof marker.command.cmd !== 'string'
    || !Array.isArray(marker.command.args) || marker.command.args.some(value => typeof value !== 'string')) return false;
  if (String(marker.fingerprint || '') !== String(fingerprint || '')) {
    return false;
  }
  return isMarkerFreshForState(marker, cacheMaxAgeMsByState);
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
  extra = null,
  signal = null,
  environment = process.env
} = {}) => {
  throwIfAborted(signal);
  const hash = crypto.createHash('sha1');
  hash.update(`schema:${WORKSPACE_COMMAND_PREFLIGHT_CACHE_SCHEMA_VERSION}`);
  hash.update(`command:${String(command || '').trim()}`);
  hash.update(`commandStat:${await commandStatIdentity(command)}`);
  hash.update(`environment:${createCommandProbeEnvironmentIdentity(environment)}`);
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
    hash.update(`digest:${await buildFileDigest({ repoRoot, filePath: entry.path, mode: entry.mode, signal })}`);
  }
  const normalizedExtra = normalizeExtraFingerprint(extra);
  if (normalizedExtra) {
    hash.update(`extra:${JSON.stringify(normalizedExtra)}`);
  }
  throwIfAborted(signal);
  return hash.digest('hex');
};

export const readWorkspaceCommandPreflightCacheHit = async ({
  repoRoot,
  cacheRoot = null,
  namespace,
  fingerprint,
  cacheMaxAgeMsByState = null
} = {}) => {
  const markerPath = resolveWorkspaceCommandPreflightMarkerPath({
    repoRoot,
    cacheRoot,
    namespace
  });
  const memoryMarker = WORKSPACE_COMMAND_PREFLIGHT_MARKER_MEMORY_CACHE.get(markerPath) || null;
  if (isReusableWorkspaceCommandPreflightMarker({
    marker: memoryMarker,
    fingerprint,
    cacheMaxAgeMsByState
  })) {
    return { markerPath, hit: true, marker: memoryMarker };
  }
  const marker = withoutGeneratedCacheMetadata(await readJsonFileSafe(markerPath, {
    fallback: null,
    maxBytes: WORKSPACE_COMMAND_PREFLIGHT_MARKER_MAX_BYTES
  }));
  if (!isReusableWorkspaceCommandPreflightMarker({
    marker,
    fingerprint,
    cacheMaxAgeMsByState
  })) {
    return { markerPath, hit: false };
  }
  WORKSPACE_COMMAND_PREFLIGHT_MARKER_MEMORY_CACHE.set(markerPath, marker);
  return { markerPath, hit: true, marker };
};

export const writeWorkspaceCommandPreflightCacheMarker = async ({
  repoRoot,
  cacheRoot = null,
  namespace,
  fingerprint,
  command,
  args,
  durationMs,
  state = 'ready',
  reasonCode = null,
  message = '',
  check = null,
  checks = [],
  signal = null
} = {}) => {
  throwIfAborted(signal);
  const markerPath = resolveWorkspaceCommandPreflightMarkerPath({
    repoRoot,
    cacheRoot,
    namespace
  });
  const marker = {
    schemaVersion: WORKSPACE_COMMAND_PREFLIGHT_CACHE_SCHEMA_VERSION,
    completedAt: new Date().toISOString(),
    fingerprint: String(fingerprint || ''),
    command: {
      cmd: String(command || ''),
      args: Array.isArray(args) ? args.map((entry) => String(entry)) : []
    },
    state: String(state || 'ready').trim() || 'ready',
    reasonCode: String(reasonCode || '').trim() || null,
    message: String(message || '').trim() || '',
    check: check && typeof check === 'object'
      ? {
        name: String(check.name || '').trim() || null,
        status: String(check.status || '').trim() || null,
        message: String(check.message || '').trim() || ''
      }
      : null,
    checks: Array.isArray(checks)
      ? checks
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          name: String(entry.name || '').trim() || null,
          status: String(entry.status || '').trim() || null,
          message: String(entry.message || '').trim() || ''
        }))
      : [],
    durationMs: Number.isFinite(Number(durationMs))
      ? Math.max(0, Math.round(Number(durationMs)))
      : null
  };
  await writeToolingCacheJson(markerPath, withGeneratedCacheMetadata(marker, 'workspace-preflight'), {
    spaces: 0,
    newline: false,
    signal
  });
  throwIfAborted(signal);
  WORKSPACE_COMMAND_PREFLIGHT_MARKER_MEMORY_CACHE.set(markerPath, marker);
  return markerPath;
};
