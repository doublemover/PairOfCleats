#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { acquireFileLock } from '../../src/shared/locks/file-lock.js';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { readManagedLuaSelection } from '../../src/shared/managed-lua.js';
import { extractArchive, getArchiveExtractionSession } from '../shared/archive-extraction.js';
import { createArchiveResourceOwner, removeOwnedArchiveDirectory } from '../shared/archive-resource-owner.js';
import { createCli } from '../../src/shared/cli.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import {
  computeSha256,
  createInstallError,
  downloadToBuffer,
  jitterForAttempt,
  normalizeChecksum,
  sleep,
  toInt
} from './install-shared.js';

const GITHUB_REPO = 'LuaLS/lua-language-server';
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_JITTER_MS = 200;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const LUA_ARCHIVE_LIMITS = Object.freeze({ maxBytes: 256 * 1024 * 1024, maxEntryBytes: 128 * 1024 * 1024, maxEntries: 50_000 });
const unknownLuaFailure = (error, inspectionError) => {
  const failure = new AggregateError([error, inspectionError], 'Lua failure inspection remains unknown.', { cause: error });
  const session = getArchiveExtractionSession(error);
  Object.defineProperties(failure, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => false },
    ...(session ? { archiveExtractionSession: { value: session } } : {}) });
  return failure;
};

const parseArgs = () => createCli({
  scriptName: 'install-lua-language-server',
  options: {
    scope: { type: 'string', default: 'cache' },
    'tooling-root': { type: 'string' },
    'release-tag': { type: 'string', default: '' },
    url: { type: 'string', default: '' },
    'timeout-ms': { type: 'number', default: DEFAULT_TIMEOUT_MS },
    retries: { type: 'number', default: DEFAULT_RETRIES },
    'retry-base-ms': { type: 'number', default: DEFAULT_RETRY_BASE_MS },
    'retry-jitter-ms': { type: 'number', default: DEFAULT_RETRY_JITTER_MS }
  }
})
  .strictOptions()
  .parse();

const resolveAssetSuffix = ({ platform = process.platform, arch = process.arch } = {}) => {
  const normalizedPlatform = String(platform || '').trim().toLowerCase();
  const normalizedArch = String(arch || '').trim().toLowerCase();
  if (normalizedPlatform === 'win32') {
    if (normalizedArch === 'x64') return 'win32-x64.zip';
    if (normalizedArch === 'ia32') return 'win32-ia32.zip';
  }
  if (normalizedPlatform === 'darwin') {
    if (normalizedArch === 'x64') return 'darwin-x64.tar.gz';
    if (normalizedArch === 'arm64') return 'darwin-arm64.tar.gz';
  }
  if (normalizedPlatform === 'linux') {
    if (normalizedArch === 'x64') return 'linux-x64.tar.gz';
    if (normalizedArch === 'arm64') return 'linux-arm64.tar.gz';
  }
  throw createInstallError(
    'unsupported_platform',
    `Unsupported lua-language-server platform/arch combination: ${normalizedPlatform}/${normalizedArch}.`,
    { retryable: false }
  );
};

export const validateLuaLanguageServerPackageLayout = (rootDir, { requireExecutable = true } = {}) => {
  const root = path.resolve(String(rootDir || '.'));
  const executableName = process.platform === 'win32' ? 'lua-language-server.exe' : 'lua-language-server';
  const executablePath = path.join(root, 'bin', executableName);
  const mainLuaPath = path.join(root, 'bin', 'main.lua');
  try {
    for (const file of [executablePath, mainLuaPath]) {
      assertNoSymlinkPath(root, file);
      const stat = fsSync.lstatSync(file);
      if (!stat.isFile() || stat.size === 0) throw new Error('Lua package requires nonempty regular runtime files.');
      if (requireExecutable && process.platform !== 'win32' && file === executablePath && (stat.mode & 0o111) === 0) {
        throw new Error('Lua runtime command requires executable permission.');
      }
    }
    return { ok: true, root, executablePath, mainLuaPath, verificationLevel: 'nonempty-contained-runtime-files' };
  } catch (error) {
    let pending, code;
    try { pending = error?.cacheOwnershipPending === true || typeof error?.cacheOwnershipReleased === 'function'; code = error?.code; }
    catch (inspectionError) { throw unknownLuaFailure(error, inspectionError); }
    if (pending) throw error;
    return { ok: false, root, executablePath, mainLuaPath, reason: typeof code === 'string' && code ? code : 'invalid-runtime-files' };
  }
};

const findLuaLanguageServerPackageRoot = async (extractRoot) => {
  const direct = validateLuaLanguageServerPackageLayout(extractRoot, { requireExecutable: false });
  if (direct.ok) return direct.root;
  let entries = [];
  try {
    entries = await fs.readdir(extractRoot, { withFileTypes: true });
  } catch (error) {
    let pending, code;
    try { pending = error?.cacheOwnershipPending === true || typeof error?.cacheOwnershipReleased === 'function'; code = error?.code; }
    catch (inspectionError) { throw unknownLuaFailure(error, inspectionError); }
    if (!pending && (code === 'ENOENT' || code === 'ENOTDIR')) return null;
    throw error;
  }
  const subdirs = entries.filter((entry) => entry.isDirectory());
  if (subdirs.length !== 1) return null;
  const nested = validateLuaLanguageServerPackageLayout(path.join(extractRoot, subdirs[0].name), { requireExecutable: false });
  return nested.ok ? nested.root : null;
};

const fetchJson = async (url, timeoutMs) => {
  const response = await downloadToBuffer({ url, timeoutMs, maxBytes: 2 * 1024 * 1024,
    label: 'lua-language-server release metadata', headers: {
      'User-Agent': 'PairOfCleats lua-language-server installer', Accept: 'application/vnd.github+json'
    } });
  return JSON.parse(response.body.toString('utf8'));
};

const resolveArchiveType = (value) => {
  const lower = String(value || '').trim().toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  return null;
};

const resolveLocalArchivePath = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('file://')) {
    return new URL(raw);
  }
  const absolute = path.resolve(raw);
  return absolute;
};

const downloadArchive = async ({ url, timeoutMs }) => {
  return downloadToBuffer({
    url,
    timeoutMs,
    maxBytes: MAX_ARCHIVE_BYTES,
    label: 'lua-language-server',
    headers: {
      'User-Agent': 'PairOfCleats lua-language-server installer'
    },
    createErrorMessage: (reason, details) => {
      if (reason === 'download_http_error') {
        return `Failed to download lua-language-server (${details.statusCode} ${details.statusText}).`;
      }
      if (reason === 'download_empty_payload') return 'Downloaded empty lua-language-server payload.';
      if (reason === 'download_timeout') return `Timed out downloading lua-language-server after ${details.timeoutMs}ms.`;
      if (reason === 'download_network_error') return `Failed to download lua-language-server: ${details.message || details.errorText}`;
      return null;
    }
  });
};

const readLocalArchive = async file => {
  const source = file instanceof URL ? fileURLToPath(file) : file;
  const owner = createArchiveResourceOwner(source);
  // An explicitly selected source is never a deletion target. This owner only
  // drains/closes the exact original input descriptor.
  owner.setCleanup(async () => {});
  let result;
  try {
    const input = await owner.open(source, 'r');
    const before = await owner.stat(input), size = Number(before.size);
    if (!before.isFile() || !Number.isSafeInteger(size) || size <= 0 || size > MAX_ARCHIVE_BYTES) {
      throw createInstallError('invalid_archive', 'Lua archive must be a nonempty bounded regular file.', { retryable: false });
    }
    const chunks = []; let read = 0;
    for await (const chunk of owner.range(input, 0, size)) { chunks.push(chunk); read += chunk.length; }
    const after = await owner.stat(input);
    if (read !== size || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw createInstallError('archive_source_changed', 'Lua archive source changed while being read.', { retryable: false });
    }
    result = Buffer.concat(chunks, read);
  } catch (value) { owner.record(value); }
  await owner.finish();
  return result;
};

const resolveArchiveSource = async ({ url, version, timeoutMs }) => {
  const explicitUrl = String(url || '').trim();
  if (explicitUrl) {
    const archiveType = resolveArchiveType(explicitUrl);
    if (!archiveType) {
      throw createInstallError('invalid_archive', `Unsupported lua-language-server archive type: ${explicitUrl}`, { retryable: false });
    }
    const localCandidate = resolveLocalArchivePath(explicitUrl);
    let local = localCandidate instanceof URL;
    if (!local) {
      try { await fs.stat(localCandidate); local = true; }
      catch (value) { if (!['ENOENT', 'ENOTDIR'].includes(value?.code)) throw value; }
    }
    if (local) {
      const buffer = await readLocalArchive(localCandidate);
      return {
        archiveType,
        body: buffer,
        sha256: computeSha256(buffer),
        sourceUrl: explicitUrl
      };
    }
    const remote = await downloadArchive({ url: explicitUrl, timeoutMs });
    return { ...remote, archiveType };
  }

  const releaseUrl = String(version || '').trim()
    ? `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${encodeURIComponent(String(version).trim())}`
    : `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const release = await fetchJson(releaseUrl, timeoutMs);
  const assetSuffix = resolveAssetSuffix({});
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const asset = assets.find((entry) => String(entry?.name || '').trim().endsWith(assetSuffix));
  if (!asset?.browser_download_url) {
    throw createInstallError('asset_missing', `Could not find lua-language-server release asset for ${assetSuffix}.`, { retryable: false });
  }
  const archiveType = resolveArchiveType(asset.name);
  if (!archiveType) {
    throw createInstallError('invalid_archive', `Unsupported lua-language-server asset type: ${asset.name}`, { retryable: false });
  }
  const remote = await downloadArchive({ url: asset.browser_download_url, timeoutMs });
  return {
    ...remote,
    archiveType,
    expectedSha256: normalizeChecksum(String(asset.digest || '').replace(/^sha256:/i, ''))
  };
};

const resolveToolingRoot = (argv) => {
  const scope = String(argv.scope || 'cache').trim().toLowerCase();
  if (scope !== 'cache') {
    throw createInstallError('invalid_scope', 'lua-language-server installer currently supports cache scope only.', { retryable: false });
  }
  const toolingRoot = String(argv['tooling-root'] || '').trim();
  if (!toolingRoot) {
    throw createInstallError('invalid_config', 'Missing --tooling-root for cache lua-language-server install.', { retryable: false });
  }
  return path.resolve(toolingRoot);
};

export const installLuaLanguageServer = async (argv, hooks = {}) => {
  const toolingRoot = resolveToolingRoot(argv);
  const beforeSelection = readManagedLuaSelection(toolingRoot);
  if (beforeSelection.status === 'invalid') throw createInstallError('invalid_existing_selection',
    'Existing Lua selection is unknown or unreadable; its receipt and generations were preserved.');
  const requireUnchangedSelection = () => {
    const current = readManagedLuaSelection(toolingRoot);
    if (current.status !== beforeSelection.status || current.sha256 !== beforeSelection.sha256) {
      throw createInstallError('lua_selection_changed', 'Lua selection changed after installation began; current receipt and generations were preserved.');
    }
  };
  const timeoutMs = toInt(argv['timeout-ms'], DEFAULT_TIMEOUT_MS, 1);
  const retries = toInt(argv.retries, DEFAULT_RETRIES, 0);
  const retryBaseMs = toInt(argv['retry-base-ms'], DEFAULT_RETRY_BASE_MS, 0);
  const retryJitterMs = toInt(argv['retry-jitter-ms'], DEFAULT_RETRY_JITTER_MS, 0);
  const attempts = [];
  let archive = null;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      archive = await resolveArchiveSource({
        url: argv.url,
        version: argv['release-tag'],
        timeoutMs
      });
      attempts.push({ attempt, status: 'ok' });
      break;
    } catch (error) {
      let reason = 'download_failed', retryable = false, pending = false;
      try {
        const originalReason = error?.reason;
        if (typeof originalReason === 'string') reason = originalReason;
        retryable = error?.retryable === true;
        const held = getArchiveExtractionSession(error);
        // A source-owned observation/capability is reconciled explicitly; it
        // cannot be made retryable by an HTTP classification alone.
        pending = Boolean(held && !held.isSettled()) || error?.cacheOwnershipPending === true
          || typeof error?.cacheOwnershipReleased === 'function';
      } catch (inspectionError) {
        throw unknownLuaFailure(error, inspectionError);
      }
      attempts.push({
        attempt,
        status: 'error',
        reason,
        message: 'Lua archive source resolution failed.'
      });
      if (pending || !retryable || attempt > retries) {
        throw error;
      }
      const backoffMs = Math.min(5_000, (retryBaseMs * attempt) + jitterForAttempt(attempt, retryJitterMs));
      await sleep(backoffMs);
    }
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lua-language-server-'));
  const temporaryOwner = createArchiveResourceOwner(tempRoot);
  let tempIdentity = null;
  temporaryOwner.setCleanup(() => removeOwnedArchiveDirectory(tempRoot, tempIdentity));
  const archiveType = archive.archiveType;
  const archivePath = path.join(tempRoot, `lua-language-server.${archiveType === 'zip' ? 'zip' : 'tar.gz'}`);
  const extractRoot = path.join(tempRoot, 'extract');
  let result;
  try {
    tempIdentity = await fs.lstat(tempRoot, { bigint: true });
    await fs.writeFile(archivePath, archive.body, { flag: 'wx' });
    if (archive.expectedSha256 && normalizeChecksum(archive.expectedSha256) !== normalizeChecksum(archive.sha256)) {
      throw createInstallError(
        'checksum_mismatch',
        `lua-language-server checksum mismatch (expected ${archive.expectedSha256}, received ${archive.sha256}).`,
        { retryable: false }
      );
    }
    await extractArchive(archivePath, extractRoot, archiveType, LUA_ARCHIVE_LIMITS);
    const packageRoot = await findLuaLanguageServerPackageRoot(extractRoot);
    if (!packageRoot) {
      throw createInstallError('invalid_layout', 'lua-language-server archive did not contain the expected bin/main.lua package layout.', { retryable: false });
    }
    // Shared extraction deliberately writes inert regular files. The selected
    // Lua executable gets its required mode explicitly before staging/publish.
    if (process.platform !== 'win32') await fs.chmod(path.join(packageRoot, 'bin', 'lua-language-server'), 0o755);
    const owner = path.join(toolingRoot, 'servers', 'lua-language-server');
    assertNoSymlinkPath(path.dirname(toolingRoot), owner, { allowMissing: true });
    await fs.mkdir(owner, { recursive: true });
    const generation = randomUUID();
    const stage = path.join(owner, `.staging-${generation}`), final = path.join(owner, generation);
    const stageOwner = createArchiveResourceOwner(stage);
    let stageIdentity = null, staged = true, lock = null, validated;
    stageOwner.setCleanup(async () => {
      if (staged) await removeOwnedArchiveDirectory(stage, stageIdentity);
      if (lock) {
        if (await lock.release() !== true) throw createInstallError('lua_lock_release_unconfirmed', 'Original Lua publication lock did not confirm release.');
        lock = null;
      }
    });
    try {
      lock = await acquireFileLock({ lockPath: path.join(owner, 'install.lock'), waitMs: 5000, timeoutBehavior: 'throw' });
      if (!lock) throw createInstallError('lua_lock_unavailable', 'Lua publication lock was not acquired.');
      requireUnchangedSelection();
      await fs.mkdir(stage);
      stageIdentity = await fs.lstat(stage, { bigint: true });
      for (const entry of await fs.readdir(packageRoot)) {
        await (hooks.copy || fs.cp)(path.join(packageRoot, entry), path.join(stage, entry), { recursive: true, force: false, errorOnExist: true });
      }
      const layout = validateLuaLanguageServerPackageLayout(stage);
      if (!layout.ok) throw createInstallError('invalid_layout', 'Lua replacement has missing runtime bytes.', { retryable: false });
      await hooks.afterValidation?.(stage);
      if (!validateLuaLanguageServerPackageLayout(stage).ok) throw createInstallError('invalid_layout', 'Lua runtime changed after staging validation.');
      await fs.rename(stage, final);
      staged = false;
      await hooks.beforeSelection?.(final);
      if (!validateLuaLanguageServerPackageLayout(final).ok) throw createInstallError('invalid_layout', 'Lua runtime changed before selection publication.');
      await atomicWriteJson(path.join(owner, 'current.json'), { schemaVersion: 1, generation, sha256: archive.sha256 },
        { durable: true, createOnly: beforeSelection.status === 'missing', beforeCommit: requireUnchangedSelection });
      validated = validateLuaLanguageServerPackageLayout(final);
    } catch (error) {
      if (!staged) stageOwner.setRecoveryContext({ currentPointer: beforeSelection.target, retainedReplacement: final,
        priorGenerationRetained: true, deletionAuthority: false });
      stageOwner.record(error);
    }
    await stageOwner.finish({ cleanupOnSuccess: true });
    result = {
      toolingRoot,
      executablePath: validated.executablePath,
      mainLuaPath: validated.mainLuaPath,
      sourceUrl: archive.sourceUrl,
      sha256: archive.sha256,
      attempts
    };
  } catch (error) { temporaryOwner.record(error); }
  await temporaryOwner.finish({ cleanupOnSuccess: true });
  return result;
};

if (isDirectExecution(import.meta.url)) {
  const argv = parseArgs();
  installLuaLanguageServer(argv)
    .then((result) => {
      console.error(`Installed lua-language-server to ${result.toolingRoot}`);
    })
    .catch((error) => {
      const reason = String(error?.reason || 'install_failed');
      const message = error?.message || String(error);
      console.error(`install-lua-language-server failed [${reason}]: ${message}`);
      process.exit(1);
    });
}

