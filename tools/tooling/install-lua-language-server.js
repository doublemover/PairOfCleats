#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { createCli } from '../../src/shared/cli.js';

const GITHUB_REPO = 'LuaLS/lua-language-server';
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_JITTER_MS = 200;

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

const toInt = (value, fallback, min = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
};

const sleep = async (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const jitterForAttempt = (attempt, jitterMs) => {
  if (!Number.isFinite(jitterMs) || jitterMs <= 0) return 0;
  const seed = (attempt * 193) + 17;
  return seed % (Math.floor(jitterMs) + 1);
};

const withTimeoutSignal = (timeoutMs) => {
  const abortController = new AbortController();
  const timer = setTimeout(() => {
    abortController.abort(new Error(`timeout after ${timeoutMs}ms`));
  }, timeoutMs);
  return {
    signal: abortController.signal,
    clear: () => clearTimeout(timer)
  };
};

const createInstallError = (reason, message, options = {}) => {
  const error = new Error(message);
  error.reason = reason;
  error.retryable = options.retryable === true;
  if (Number.isInteger(options.statusCode)) {
    error.statusCode = options.statusCode;
  }
  if (options.cause) error.cause = options.cause;
  return error;
};

const normalizeChecksum = (value) => String(value || '').trim().toLowerCase();
const computeSha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

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

export const validateLuaLanguageServerPackageLayout = (rootDir) => {
  const root = path.resolve(String(rootDir || '.'));
  const executableName = process.platform === 'win32' ? 'lua-language-server.exe' : 'lua-language-server';
  const executablePath = path.join(root, 'bin', executableName);
  const mainLuaPath = path.join(root, 'bin', 'main.lua');
  return {
    ok: Boolean(root && executablePath && mainLuaPath),
    root,
    executablePath,
    mainLuaPath
  };
};

const findLuaLanguageServerPackageRoot = async (extractRoot) => {
  const direct = validateLuaLanguageServerPackageLayout(extractRoot);
  const directExists = await Promise.all([
    fs.stat(direct.executablePath).then(() => true).catch(() => false),
    fs.stat(direct.mainLuaPath).then(() => true).catch(() => false)
  ]);
  if (directExists.every(Boolean)) return direct.root;
  let entries = [];
  try {
    entries = await fs.readdir(extractRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const subdirs = entries.filter((entry) => entry.isDirectory());
  if (subdirs.length !== 1) return null;
  const nested = validateLuaLanguageServerPackageLayout(path.join(extractRoot, subdirs[0].name));
  const nestedExists = await Promise.all([
    fs.stat(nested.executablePath).then(() => true).catch(() => false),
    fs.stat(nested.mainLuaPath).then(() => true).catch(() => false)
  ]);
  return nestedExists.every(Boolean) ? nested.root : null;
};

const isRetryableHttpStatus = (statusCode) => statusCode === 408 || statusCode === 429 || statusCode >= 500;

const fetchJson = async (url, timeoutMs) => {
  const timeout = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PairOfCleats lua-language-server installer',
        Accept: 'application/vnd.github+json'
      },
      redirect: 'follow',
      signal: timeout.signal
    });
    if (!response.ok) {
      throw createInstallError(
        'download_http_error',
        `Failed to query ${url} (${response.status} ${response.statusText}).`,
        { retryable: isRetryableHttpStatus(response.status), statusCode: response.status }
      );
    }
    return await response.json();
  } catch (error) {
    if (error?.reason) throw error;
    const timeoutTriggered = timeout.signal?.aborted === true;
    const message = String(error?.message || '');
    if (timeoutTriggered || error?.name === 'AbortError' || /timeout/i.test(message)) {
      throw createInstallError('download_timeout', `Timed out querying ${url} after ${timeoutMs}ms.`, { retryable: true, cause: error });
    }
    throw createInstallError('download_network_error', `Failed to query ${url}: ${message || String(error)}`, { retryable: true, cause: error });
  } finally {
    timeout.clear();
  }
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
  const timeout = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PairOfCleats lua-language-server installer'
      },
      redirect: 'follow',
      signal: timeout.signal
    });
    if (!response.ok) {
      throw createInstallError(
        'download_http_error',
        `Failed to download lua-language-server (${response.status} ${response.statusText}).`,
        { retryable: isRetryableHttpStatus(response.status), statusCode: response.status }
      );
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length) {
      throw createInstallError('download_empty_payload', 'Downloaded empty lua-language-server payload.', { retryable: false });
    }
    return {
      body,
      sha256: computeSha256(body),
      sourceUrl: response.url || url
    };
  } catch (error) {
    if (error?.reason) throw error;
    const timeoutTriggered = timeout.signal?.aborted === true;
    const message = String(error?.message || '');
    if (timeoutTriggered || error?.name === 'AbortError' || /timeout/i.test(message)) {
      throw createInstallError('download_timeout', `Timed out downloading lua-language-server after ${timeoutMs}ms.`, { retryable: true, cause: error });
    }
    throw createInstallError('download_network_error', `Failed to download lua-language-server: ${message || String(error)}`, { retryable: true, cause: error });
  } finally {
    timeout.clear();
  }
};

const resolveArchiveSource = async ({ url, version, timeoutMs }) => {
  const explicitUrl = String(url || '').trim();
  if (explicitUrl) {
    const archiveType = resolveArchiveType(explicitUrl);
    if (!archiveType) {
      throw createInstallError('invalid_archive', `Unsupported lua-language-server archive type: ${explicitUrl}`, { retryable: false });
    }
    const localCandidate = resolveLocalArchivePath(explicitUrl);
    if (localCandidate instanceof URL || await fs.stat(localCandidate).then(() => true).catch(() => false)) {
      const buffer = await fs.readFile(localCandidate instanceof URL ? localCandidate : localCandidate);
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

const extractArchive = async ({ archivePath, archiveType, destination }) => {
  await fs.mkdir(destination, { recursive: true });
  if (archiveType === 'zip') {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(destination, true);
    return;
  }
  if (archiveType === 'tar.gz') {
    const tar = await import('tar');
    await tar.x({
      cwd: destination,
      file: archivePath,
      gzip: true
    });
    return;
  }
  throw createInstallError('invalid_archive', `Unsupported lua-language-server archive type: ${archiveType}`, { retryable: false });
};

const removeExistingLuaLanguageServerLayout = async (toolingRoot) => {
  const removals = [
    path.join(toolingRoot, 'bin', 'lua-language-server.exe'),
    path.join(toolingRoot, 'bin', 'lua-language-server'),
    path.join(toolingRoot, 'bin', 'main.lua'),
    path.join(toolingRoot, 'main.lua'),
    path.join(toolingRoot, 'debugger.lua'),
    path.join(toolingRoot, 'changelog.md'),
    path.join(toolingRoot, 'LICENSE'),
    path.join(toolingRoot, 'locale'),
    path.join(toolingRoot, 'meta'),
    path.join(toolingRoot, 'script')
  ];
  for (const entry of removals) {
    await fs.rm(entry, { recursive: true, force: true }).catch(() => {});
  }
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

export const installLuaLanguageServer = async (argv) => {
  const toolingRoot = resolveToolingRoot(argv);
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
      attempts.push({
        attempt,
        status: 'error',
        reason: String(error?.reason || 'download_failed'),
        message: error?.message || String(error)
      });
      if (error?.retryable !== true || attempt > retries) {
        throw error;
      }
      const backoffMs = Math.min(5_000, (retryBaseMs * attempt) + jitterForAttempt(attempt, retryJitterMs));
      await sleep(backoffMs);
    }
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lua-language-server-'));
  const archiveType = archive.archiveType;
  const archivePath = path.join(tempRoot, `lua-language-server.${archiveType === 'zip' ? 'zip' : 'tar.gz'}`);
  const extractRoot = path.join(tempRoot, 'extract');
  try {
    await fs.writeFile(archivePath, archive.body);
    if (archive.expectedSha256 && normalizeChecksum(archive.expectedSha256) !== normalizeChecksum(archive.sha256)) {
      throw createInstallError(
        'checksum_mismatch',
        `lua-language-server checksum mismatch (expected ${archive.expectedSha256}, received ${archive.sha256}).`,
        { retryable: false }
      );
    }
    await extractArchive({ archivePath, archiveType, destination: extractRoot });
    const packageRoot = await findLuaLanguageServerPackageRoot(extractRoot);
    if (!packageRoot) {
      throw createInstallError('invalid_layout', 'lua-language-server archive did not contain the expected bin/main.lua package layout.', { retryable: false });
    }
    await fs.mkdir(toolingRoot, { recursive: true });
    await removeExistingLuaLanguageServerLayout(toolingRoot);
    const entries = await fs.readdir(packageRoot);
    for (const entry of entries) {
      await fs.cp(path.join(packageRoot, entry), path.join(toolingRoot, entry), { recursive: true, force: true });
    }
    const validated = validateLuaLanguageServerPackageLayout(toolingRoot);
    const layoutChecks = await Promise.all([
      fs.stat(validated.executablePath).then(() => true).catch(() => false),
      fs.stat(validated.mainLuaPath).then(() => true).catch(() => false)
    ]);
    if (!layoutChecks.every(Boolean)) {
      throw createInstallError('invalid_layout', 'lua-language-server install completed without the required runtime payload.', { retryable: false });
    }
    return {
      toolingRoot,
      executablePath: validated.executablePath,
      mainLuaPath: validated.mainLuaPath,
      sourceUrl: archive.sourceUrl,
      sha256: archive.sha256,
      attempts
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
};

const isMainModule = (() => {
  try {
    return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMainModule) {
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
