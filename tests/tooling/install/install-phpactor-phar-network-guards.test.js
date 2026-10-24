#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'tooling', 'install-phpactor-phar.js');
const { dir: tempRoot } = await prepareIsolatedTestCacheDir('install-phpactor-phar-network');
const scenarios = new Map();
const server = http.createServer((request, response) => {
  const scenario = scenarios.get(request.url);
  if (!scenario) { response.writeHead(404).end(); return; }
  const item = scenario.steps[Math.min(scenario.calls++, scenario.steps.length - 1)];
  if (item.type === 'timeout') return;
  if (item.type === 'network-error') { response.destroy(); return; }
  response.writeHead(Number(item.status || 200));
  response.end(String(item.body || ''));
});
await fs.mkdir(tempRoot, { recursive: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const runWithScenario = async ({ steps, args }) => {
  const id = `/${scenarios.size}`;
  scenarios.set(id, { steps, calls: 0 });
  const fixtureArgs = [...args];
  fixtureArgs[fixtureArgs.indexOf('--url') + 1] = `http://127.0.0.1:${server.address().port}${id}`;
  const result = await spawnSubprocess(process.execPath,
    [scriptPath, '--sha256', crypto.createHash('sha256').update(String(steps.at(-1)?.body || 'unused')).digest('hex'), ...fixtureArgs],
    { cwd: root, env: { ...applyTestEnv({ syncProcess: false }), PAIROFCLEATS_ALLOW_LOCAL_DOWNLOADS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'], timeoutMs: 5000, maxOutputBytes: 65536, outputMode: 'string', rejectOnNonZeroExit: false });
  return { ...result, status: result.exitCode };
};
try {
  const missingDigestReport = path.join(tempRoot, 'missing-digest-report.json');
  const missingDigest = runNode([scriptPath, '--bin-dir', path.join(tempRoot, 'missing-digest'),
    '--url', 'https://example.invalid/unused', '--report', missingDigestReport],
  'phpactor missing approved digest', root, applyTestEnv({ syncProcess: false }), { stdio: 'pipe', allowFailure: true });
  assert.equal(missingDigest.status, 1);
  assert.equal(JSON.parse(await fs.readFile(missingDigestReport, 'utf8')).reason, 'checksum_required');
  const timeoutBinDir = path.join(tempRoot, 'timeout-bin');
  const timeoutReportPath = path.join(tempRoot, 'timeout-report.json');
  const timeoutResult = await runWithScenario({
    steps: [{ type: 'timeout' }],
    args: [
      '--bin-dir',
      timeoutBinDir,
      '--url',
      'https://example.invalid/timeout',
      '--timeout-ms',
      '100',
      '--retries',
      '0',
      '--report',
      timeoutReportPath
    ]
  });
  assert.equal(timeoutResult.status, 1, `expected timeout install exit code 1, received ${timeoutResult.status}`);

  const timeoutReport = JSON.parse(await fs.readFile(timeoutReportPath, 'utf8'));
  assert.equal(timeoutReport?.status, 'error', 'expected timeout report status=error');
  assert.equal(timeoutReport?.reason, 'download_timeout', 'expected timeout failure reason code');
  const timeoutBinEntries = await fs.readdir(timeoutBinDir).catch(() => []);
  assert.equal(
    timeoutBinEntries.some((entry) => entry.includes('.tmp-')),
    false,
    'expected timeout path to clean temporary phar files'
  );

  const retryBinDir = path.join(tempRoot, 'retry-bin');
  const retryReportPath = path.join(tempRoot, 'retry-report.json');
  const retryBody = 'synthetic-phpactor-phar-payload\n';
  const retryResult = await runWithScenario({
    steps: [
      { type: 'http', status: 503, statusText: 'Service Unavailable', body: 'retry please' },
      { type: 'http', status: 200, statusText: 'OK', body: retryBody }
    ],
    args: [
      '--bin-dir',
      retryBinDir,
      '--url',
      'https://example.invalid/flaky',
      '--timeout-ms',
      '10000',
      '--retries',
      '2',
      '--report',
      retryReportPath
    ]
  });
  if (retryResult.status !== 0) {
    console.error('install-phpactor-phar network guard retry test failed');
    console.error(retryResult.stderr || retryResult.stdout || '');
  }
  assert.equal(retryResult.status, 0, `expected retry install exit code 0, received ${retryResult.status}`);

  const retryReport = JSON.parse(await fs.readFile(retryReportPath, 'utf8'));
  assert.equal(retryReport?.status, 'ok', 'expected retry report status=ok');
  assert.equal(Array.isArray(retryReport?.attempts), true, 'expected retry attempts in report');
  assert.equal(retryReport.attempts.length, 2, 'expected exactly two download attempts (503 then success)');
  assert.equal(retryReport.attempts[0]?.reason, 'download_http_error', 'expected first retry reason download_http_error');
  assert.equal(retryReport.attempts[1]?.status, 'ok', 'expected second attempt to succeed');
  assert.ok(typeof retryReport?.sha256 === 'string' && retryReport.sha256.length === 64, 'expected sha256 in success report');

  const pharPath = path.join(retryBinDir, 'phpactor.phar');
  const pharBytes = await fs.readFile(pharPath);
  assert.equal(Buffer.compare(pharBytes, Buffer.from(retryBody, 'utf8')), 0, 'expected downloaded phar payload to match fixture response payload');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('install phpactor phar network guard test passed');
