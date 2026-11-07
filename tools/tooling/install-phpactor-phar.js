#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { fetchDownloadUrl } from '../download/shared-fetch.js';
import { PHPACTOR_APPROVED_RELEASE, PHPACTOR_POSIX_SHIM, PHPACTOR_WINDOWS_SHIM } from './approved-artifacts.js';
import {
  createInstallError,
  computeSha256,
  isRetryableHttpStatus,
  jitterForAttempt,
  normalizeChecksum,
  sleep,
  toInt,
  writeInstallReport
} from './install-shared.js';

const PHPACTOR_PHAR_URL = PHPACTOR_APPROVED_RELEASE.url;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_JITTER_MS = 200;

const parseArgs = () => createCli({
  scriptName: 'install-phpactor-phar',
  options: {
    scope: { type: 'string', default: 'cache' },
    'tooling-root': { type: 'string' },
    'bin-dir': { type: 'string' },
    url: { type: 'string', default: PHPACTOR_PHAR_URL },
    'timeout-ms': { type: 'number', default: DEFAULT_TIMEOUT_MS },
    retries: { type: 'number', default: DEFAULT_RETRIES },
    'retry-base-ms': { type: 'number', default: DEFAULT_RETRY_BASE_MS },
    'retry-jitter-ms': { type: 'number', default: DEFAULT_RETRY_JITTER_MS },
    sha256: { type: 'string', default: '' },
    report: { type: 'string', default: '' }
  }
})
  .strictOptions()
  .parse();

const downloadPhar = async ({ url, timeoutMs }) => {
  try {
    const result = await fetchDownloadUrl(url, { timeoutMs, maxBytes: 32 * 1024 * 1024 });
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw createInstallError('download_http_error', `Failed to download phpactor PHAR (${result.statusCode}).`,
        { retryable: isRetryableHttpStatus(result.statusCode), statusCode: result.statusCode });
    }
    if (!result.body?.length) throw createInstallError('download_empty_payload', 'Downloaded empty phpactor PHAR payload.');
    return { body: result.body, sha256: computeSha256(result.body), sourceUrl: result.url };
  } catch (error) {
    if (error.reason) throw error;
    const timeout = error.code === 'ERR_DOWNLOAD_TIMEOUT';
    const tooLarge = error.code === 'ERR_DOWNLOAD_MAX_BYTES';
    const authority = ['ERR_DOWNLOAD_AUTHORITY', 'ERR_DOWNLOAD_REDIRECT', 'ERR_INVALID_URL'].includes(error.code);
    throw createInstallError(timeout ? 'download_timeout' : tooLarge ? 'download_too_large' : 'download_network_error',
      timeout ? `Timed out downloading phpactor PHAR after ${timeoutMs}ms.` : `Failed to download phpactor PHAR: ${error.message}`,
      { retryable: !tooLarge && !authority, cause: error });
  }
};

const writeShims = async (binDir) => {
  if (process.platform === 'win32') {
    const cmdPath = path.join(binDir, 'phpactor.cmd');
    await fs.writeFile(cmdPath, PHPACTOR_WINDOWS_SHIM, 'ascii');
    return;
  }
  const shimPath = path.join(binDir, 'phpactor');
  await fs.writeFile(
    shimPath,
    PHPACTOR_POSIX_SHIM,
    'utf8'
  );
  await fs.chmod(shimPath, 0o755);
};

const resolveBinDir = (argv) => {
  const homeDir = String(process.env.USERPROFILE || process.env.HOME || '').trim();
  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  const scope = String(argv.scope || 'cache').trim().toLowerCase();
  if (typeof argv['bin-dir'] === 'string' && argv['bin-dir'].trim()) return argv['bin-dir'].trim();
  if (scope === 'cache') {
    const toolingRoot = String(argv['tooling-root'] || '').trim();
    if (!toolingRoot) {
      throw createInstallError(
        'invalid_config',
        'Missing --tooling-root for cache phpactor install.',
        { retryable: false }
      );
    }
    return path.join(toolingRoot, 'bin');
  }
  if (process.platform === 'win32') {
    const base = localAppData || (homeDir ? path.join(homeDir, 'AppData', 'Local') : '');
    if (!base) {
      throw createInstallError(
        'invalid_config',
        'Cannot resolve LOCALAPPDATA for phpactor user install.',
        { retryable: false }
      );
    }
    return path.join(base, 'Programs', 'phpactor');
  }
  if (!homeDir) {
    throw createInstallError(
      'invalid_config',
      'Cannot resolve HOME for phpactor user install.',
      { retryable: false }
    );
  }
  return path.join(homeDir, '.local', 'bin');
};

const main = async (argv) => {
  const url = String(argv.url || PHPACTOR_PHAR_URL).trim();
  const timeoutMs = toInt(argv['timeout-ms'], DEFAULT_TIMEOUT_MS, 1);
  const retries = toInt(argv.retries, DEFAULT_RETRIES, 0);
  const retryBaseMs = toInt(argv['retry-base-ms'], DEFAULT_RETRY_BASE_MS, 0);
  const retryJitterMs = toInt(argv['retry-jitter-ms'], DEFAULT_RETRY_JITTER_MS, 0);
  const expectedSha256 = normalizeChecksum(argv.sha256);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw createInstallError('checksum_required', 'phpactor PHAR installation requires an explicitly approved --sha256 digest.', { retryable: false });
  }
  if (url.includes('/releases/latest/')) {
    throw createInstallError('immutable_url_required', 'Use an explicit immutable phpactor artifact URL with its approved digest; mutable latest URLs are not accepted.', { retryable: false });
  }
  const attempts = [];
  const binDir = resolveBinDir(argv);
  const pharPath = path.join(binDir, 'phpactor.phar');
  const tempPath = `${pharPath}.tmp-${process.pid}-${Date.now()}`;
  let download = null;

  await fs.mkdir(binDir, { recursive: true });

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const attemptStartedAt = new Date().toISOString();
    try {
      download = await downloadPhar({ url, timeoutMs });
      attempts.push({
        attempt,
        status: 'ok',
        startedAt: attemptStartedAt,
        completedAt: new Date().toISOString(),
        reason: null
      });
      break;
    } catch (error) {
      const reason = String(error?.reason || 'download_failed');
      const retryable = error?.retryable === true;
      attempts.push({
        attempt,
        status: 'error',
        startedAt: attemptStartedAt,
        completedAt: new Date().toISOString(),
        reason,
        retryable,
        statusCode: Number.isInteger(error?.statusCode) ? Number(error.statusCode) : null,
        message: error?.message || String(error)
      });
      if (!retryable || attempt > retries) {
        throw error;
      }
      const backoffMs = Math.min(5_000, (retryBaseMs * attempt) + jitterForAttempt(attempt, retryJitterMs));
      await sleep(backoffMs);
    }
  }

  if (!download || !download.body) {
    throw createInstallError('download_failed', 'Failed to download phpactor PHAR after retries.', { retryable: false });
  }

  if (expectedSha256 && normalizeChecksum(download.sha256) !== expectedSha256) {
    throw createInstallError(
      'checksum_mismatch',
      `phpactor PHAR checksum mismatch (expected ${expectedSha256}, received ${download.sha256}).`,
      { retryable: false }
    );
  }

  try {
    await fs.writeFile(tempPath, download.body);
    await fs.rename(tempPath, pharPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw createInstallError(
      'io_error',
      `Failed to write phpactor PHAR to ${pharPath}: ${error?.message || String(error)}`,
      { retryable: false, cause: error }
    );
  }

  await writeShims(binDir);

  const successPayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'ok',
    reason: null,
    url,
    sourceUrl: download.sourceUrl,
    timeoutMs,
    retries,
    binDir,
    pharPath,
    sha256: download.sha256,
    attempts
  };
  const reportPath = await writeInstallReport(argv.report, successPayload);
  if (reportPath) {
    console.error(`phpactor PHAR install report: ${reportPath}`);
  }
};

const argv = parseArgs();

main(argv).catch(async (error) => {
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'error',
    reason: String(error?.reason || 'install_failed'),
    message: error?.message || String(error)
  };
  if (argv?.report) {
    await writeInstallReport(argv.report, payload).catch(() => {});
  }
  console.error(`install-phpactor-phar failed [${payload.reason}]: ${payload.message}`);
  process.exit(1);
});
