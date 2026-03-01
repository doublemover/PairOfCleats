#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createCli } from '../../src/shared/cli.js';

const PHPACTOR_PHAR_URL = 'https://github.com/phpactor/phpactor/releases/latest/download/phpactor.phar';
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

const computeSha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const normalizeChecksum = (value) => String(value || '').trim().toLowerCase();

const isRetryableHttpStatus = (statusCode) => statusCode === 408 || statusCode === 429 || statusCode >= 500;

const writeReport = async (reportPath, payload) => {
  const target = String(reportPath || '').trim();
  if (!target) return null;
  const resolved = path.resolve(target);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return resolved;
};

const downloadPhar = async ({ url, timeoutMs }) => {
  const timeout = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: timeout.signal
    });
    if (!response.ok) {
      try {
        await response.arrayBuffer();
      } catch {}
      throw createInstallError(
        'download_http_error',
        `Failed to download phpactor PHAR (${response.status} ${response.statusText}).`,
        {
          retryable: isRetryableHttpStatus(response.status),
          statusCode: response.status
        }
      );
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length) {
      throw createInstallError(
        'download_empty_payload',
        'Downloaded empty phpactor PHAR payload.',
        { retryable: false }
      );
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
    if (
      timeoutTriggered
      || error?.name === 'AbortError'
      || /timeout/i.test(message)
    ) {
      throw createInstallError(
        'download_timeout',
        `Timed out downloading phpactor PHAR after ${timeoutMs}ms.`,
        { retryable: true, cause: error }
      );
    }
    throw createInstallError(
      'download_network_error',
      `Failed to download phpactor PHAR: ${error?.message || String(error)}`,
      { retryable: true, cause: error }
    );
  } finally {
    timeout.clear();
  }
};

const writeShims = async (binDir) => {
  if (process.platform === 'win32') {
    const cmdPath = path.join(binDir, 'phpactor.cmd');
    await fs.writeFile(cmdPath, '@echo off\r\nphp "%~dp0phpactor.phar" %*\r\n', 'ascii');
    return;
  }
  const shimPath = path.join(binDir, 'phpactor');
  await fs.writeFile(
    shimPath,
    '#!/usr/bin/env sh\nset -eu\nexec php "$(dirname "$0")/phpactor.phar" "$@"\n',
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
  const reportPath = await writeReport(argv.report, successPayload);
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
    await writeReport(argv.report, payload).catch(() => {});
  }
  console.error(`install-phpactor-phar failed [${payload.reason}]: ${payload.message}`);
  process.exit(1);
});
