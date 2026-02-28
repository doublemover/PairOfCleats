#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'tooling', 'install-phpactor-phar.js');
const tempRoot = path.join(root, '.testLogs', `install-phpactor-phar-network-${process.pid}-${Date.now()}`);
const fetchHarnessPath = path.join(tempRoot, 'fetch-harness.mjs');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

await fs.writeFile(
  fetchHarnessPath,
  [
    "import fs from 'node:fs/promises';",
    "import { pathToFileURL } from 'node:url';",
    "const [scenarioPath, scriptPath, ...scriptArgs] = process.argv.slice(2);",
    "const scenario = JSON.parse(await fs.readFile(scenarioPath, 'utf8'));",
    'let callIndex = 0;',
    "globalThis.fetch = async (_url, options = {}) => {",
    '  const item = scenario.steps[Math.min(callIndex, scenario.steps.length - 1)] || null;',
    '  callIndex += 1;',
    "  if (!item || item.type === 'network-error') throw new Error(item?.message || 'network error');",
    "  if (item.type === 'timeout') {",
    "    return await new Promise((_resolve, reject) => {",
    '      const signal = options?.signal;',
    '      if (!signal || typeof signal.addEventListener !== \"function\") return;',
    "      const onAbort = () => reject(new Error('AbortError'));",
    "      signal.addEventListener('abort', onAbort, { once: true });",
    '    });',
    '  }',
    "  const status = Number(item.status || 200);",
    "  const body = Buffer.from(String(item.body || ''), 'utf8');",
    '  return {',
    '    ok: status >= 200 && status < 300,',
    '    status,',
    "    statusText: String(item.statusText || ''),",
    "    url: String(item.url || 'mock://phpactor'),",
    '    arrayBuffer: async () => body',
    '  };',
    '};',
    "process.argv = [process.execPath, scriptPath, ...scriptArgs];",
    'await import(pathToFileURL(scriptPath).href);'
  ].join('\n'),
  'utf8'
);

const runWithScenario = async ({ steps, args }) => {
  const scenarioPath = path.join(tempRoot, `scenario-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.writeFile(scenarioPath, `${JSON.stringify({ steps }, null, 2)}\n`, 'utf8');
  const result = spawnSync(
    process.execPath,
    [fetchHarnessPath, scenarioPath, scriptPath, ...args],
    {
      cwd: root,
      env: applyTestEnv({ syncProcess: false }),
      encoding: 'utf8'
    }
  );
  return result;
};

try {
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
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('install phpactor phar network guard test passed');
