#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  computeSha256,
  createInstallError,
  downloadToBuffer,
  isRetryableHttpStatus,
  jitterForAttempt,
  normalizeChecksum,
  toInt,
  withTimeoutSignal,
  writeInstallReport
} from '../../../tools/tooling/install-shared.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `install-shared-primitives-${process.pid}-${Date.now()}`);
const delay = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const originalFetch = globalThis.fetch;

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

try {
  assert.equal(toInt('12.9', 1, 0), 12);
  assert.equal(toInt('bad', 7, 0), 7);
  assert.equal(toInt('-3', 7, 2), 2);
  assert.equal(jitterForAttempt(1, 200), 9);
  assert.equal(jitterForAttempt(2, 200), 1);
  assert.equal(jitterForAttempt(1, 0), 0);

  const clearedTimeout = withTimeoutSignal(10);
  clearedTimeout.clear();
  await delay(25);
  assert.equal(clearedTimeout.signal.aborted, false, 'expected cleared timeout signal to stay un-aborted');

  const activeTimeout = withTimeoutSignal(5);
  await delay(25);
  assert.equal(activeTimeout.signal.aborted, true, 'expected active timeout signal to abort');
  activeTimeout.clear();

  const installError = createInstallError('download_http_error', 'failed', {
    retryable: true,
    statusCode: 503,
    cause: new Error('cause')
  });
  assert.equal(installError.reason, 'download_http_error');
  assert.equal(installError.retryable, true);
  assert.equal(installError.statusCode, 503);
  assert.ok(installError.cause instanceof Error);

  assert.equal(normalizeChecksum('  ABCdef  '), 'abcdef');
  assert.equal(
    computeSha256(Buffer.from('abc', 'utf8')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.equal(isRetryableHttpStatus(408), true);
  assert.equal(isRetryableHttpStatus(429), true);
  assert.equal(isRetryableHttpStatus(500), true);
  assert.equal(isRetryableHttpStatus(404), false);

  const reportPath = path.join(tempRoot, 'reports', 'install.json');
  const writtenReportPath = await writeInstallReport(reportPath, { status: 'ok', attempts: [] });
  assert.equal(writtenReportPath, path.resolve(reportPath));
  assert.equal(await fs.readFile(reportPath, 'utf8'), '{\n  "status": "ok",\n  "attempts": []\n}\n');
  assert.equal(await writeInstallReport('', { status: 'ok' }), null);

  globalThis.fetch = async (url, options = {}) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    url: `${url}/redirected`,
    arrayBuffer: async () => Buffer.from(String(options.headers?.['X-Test'] || 'payload'), 'utf8')
  });
  const downloaded = await downloadToBuffer({
    url: 'https://example.invalid/tool',
    timeoutMs: 100,
    label: 'test tool',
    headers: { 'X-Test': 'body' }
  });
  assert.equal(downloaded.sourceUrl, 'https://example.invalid/tool/redirected');
  assert.equal(downloaded.body.toString('utf8'), 'body');
  assert.equal(downloaded.sha256, computeSha256(Buffer.from('body', 'utf8')));

  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    arrayBuffer: async () => Buffer.from('retry', 'utf8')
  });
  await assert.rejects(
    () => downloadToBuffer({
      url: 'https://example.invalid/tool',
      timeoutMs: 100,
      label: 'test tool',
      drainErrorBody: true
    }),
    (error) => {
      assert.equal(error.reason, 'download_http_error');
      assert.equal(error.retryable, true);
      assert.equal(error.statusCode, 503);
      return true;
    }
  );
} finally {
  globalThis.fetch = originalFetch;
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('install shared primitives test passed');
