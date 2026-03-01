#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { spawnSubprocessSync } from '../../src/shared/subprocess.js';
import { getRuntimeConfig, loadUserConfig, resolveRepoRootArg, resolveRuntimeEnv, resolveToolRoot } from '../shared/dict-utils.js';
import { exitLikeCommandResult } from '../shared/cli-utils.js';
import { buildTestRuntimeEnv } from '../tooling/utils.js';

const root = resolveToolRoot();
const repoRoot = resolveRepoRootArg(null, root);
const userConfig = loadUserConfig(repoRoot);
const DEFAULT_JUNIT = path.join(root, '.testLogs', 'lsp-embeddings-gates.junit.xml');
const DEFAULT_DIAGNOSTICS = path.join(root, '.testLogs', 'lsp-embeddings-gates.json');
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_TESTS = Object.freeze([
  {
    label: 'type-inference-lsp-enrichment',
    file: path.join(root, 'tests', 'indexing', 'type-inference', 'providers', 'type-inference-lsp-enrichment.test.js'),
    timeoutMs: 240_000
  },
  {
    label: 'embeddings-dims-mismatch',
    file: path.join(root, 'tests', 'indexing', 'embeddings', 'dims-mismatch.test.js'),
    timeoutMs: 180_000
  },
  {
    label: 'embeddings-cache-identity',
    file: path.join(root, 'tests', 'indexing', 'embeddings', 'cache-identity.test.js'),
    timeoutMs: 180_000
  }
]);

const parseArgs = () => createCli({
  scriptName: 'pairofcleats run-lsp-embeddings-gates',
  options: {
    junit: { type: 'string', default: DEFAULT_JUNIT },
    diagnostics: { type: 'string', default: DEFAULT_DIAGNOSTICS },
    'tests-json': { type: 'string', default: '' },
    'default-timeout-ms': { type: 'number', default: DEFAULT_TIMEOUT_MS }
  }
})
  .strictOptions()
  .parse();

const escapeXml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll('\'', '&apos;');

const toTimeoutMs = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const resolveTestsFromPayload = (payload, testsJsonPath, defaultTimeoutMs) => {
  if (!Array.isArray(payload) || !payload.length) {
    throw new Error(`Expected non-empty test array in ${testsJsonPath}`);
  }
  return payload.map((entry, index) => {
    const label = String(entry?.label || '').trim();
    const fileRaw = String(entry?.file || '').trim();
    if (!label) throw new Error(`Missing "label" for test index ${index} in ${testsJsonPath}`);
    if (!fileRaw) throw new Error(`Missing "file" for test "${label}" in ${testsJsonPath}`);
    const file = path.isAbsolute(fileRaw)
      ? fileRaw
      : path.resolve(path.dirname(testsJsonPath), fileRaw);
    return {
      label,
      file,
      timeoutMs: toTimeoutMs(entry?.timeoutMs, defaultTimeoutMs)
    };
  });
};

const resolveTests = (argv) => {
  const defaultTimeoutMs = toTimeoutMs(argv['default-timeout-ms'], DEFAULT_TIMEOUT_MS);
  if (!argv['tests-json']) {
    return DEFAULT_TESTS.map((test) => ({
      ...test,
      timeoutMs: toTimeoutMs(test.timeoutMs, defaultTimeoutMs)
    }));
  }
  const testsJsonPath = path.resolve(String(argv['tests-json'] || ''));
  const parsed = JSON.parse(fs.readFileSync(testsJsonPath, 'utf8'));
  return resolveTestsFromPayload(parsed, testsJsonPath, defaultTimeoutMs);
};

const ensureTestsExist = (tests) => {
  for (const test of tests) {
    if (!fs.existsSync(test.file)) {
      throw new Error(`lsp/embeddings gate misconfigured: missing test file for ${test.label}: ${test.file}`);
    }
  }
};

const runGateTest = (test, env) => {
  const startedAtMs = Date.now();
  try {
    const result = spawnSubprocessSync(process.execPath, [test.file], {
      stdio: 'inherit',
      rejectOnNonZeroExit: false,
      cwd: repoRoot,
      env,
      timeoutMs: test.timeoutMs
    });
    return {
      label: test.label,
      file: test.file,
      timeoutMs: test.timeoutMs,
      startedAt: new Date(startedAtMs).toISOString(),
      durationMs: Date.now() - startedAtMs,
      status: result.exitCode === 0 ? 'passed' : 'failed',
      reason: result.exitCode === 0 ? null : 'exit_non_zero',
      exitCode: result.exitCode,
      signal: result.signal
    };
  } catch (error) {
    return {
      label: test.label,
      file: test.file,
      timeoutMs: test.timeoutMs,
      startedAt: new Date(startedAtMs).toISOString(),
      durationMs: Date.now() - startedAtMs,
      status: 'failed',
      reason: error?.code === 'SUBPROCESS_TIMEOUT' ? 'timeout' : 'spawn_error',
      exitCode: error?.result?.exitCode ?? null,
      signal: error?.result?.signal ?? null,
      error: error?.message || String(error)
    };
  }
};

const writeJUnit = async (junitPath, results) => {
  if (!junitPath) return null;
  const resolved = path.resolve(junitPath);
  await fsPromises.mkdir(path.dirname(resolved), { recursive: true });
  const failures = results.filter((entry) => entry.status !== 'passed').length;
  const totalSeconds = (results.reduce((sum, entry) => sum + (Number(entry.durationMs) || 0), 0) / 1000).toFixed(3);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="lsp-embeddings-gates" tests="${results.length}" failures="${failures}" errors="0" skipped="0" time="${totalSeconds}">`
  ];
  for (const result of results) {
    const caseTime = ((Number(result.durationMs) || 0) / 1000).toFixed(3);
    lines.push(
      `  <testcase classname="lsp-embeddings-gates" name="${escapeXml(result.label)}" file="${escapeXml(result.file)}" time="${caseTime}">`
    );
    if (result.status !== 'passed') {
      const failureType = result.reason === 'timeout' ? 'timeout' : 'failure';
      const message = result.reason === 'timeout'
        ? `timed out after ${result.timeoutMs}ms`
        : `exited with code ${result.exitCode ?? 'unknown'}${result.signal ? ` (signal ${result.signal})` : ''}`;
      lines.push(`    <failure type="${failureType}" message="${escapeXml(message)}"/>`);
    }
    lines.push('  </testcase>');
  }
  lines.push('</testsuite>');
  await fsPromises.writeFile(resolved, `${lines.join('\n')}\n`, 'utf8');
  return resolved;
};

const writeDiagnostics = async (diagnosticsPath, payload) => {
  if (!diagnosticsPath) return null;
  const resolved = path.resolve(diagnosticsPath);
  await fsPromises.mkdir(path.dirname(resolved), { recursive: true });
  await fsPromises.writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return resolved;
};

const main = async () => {
  const argv = parseArgs();
  const tests = resolveTests(argv);
  ensureTestsExist(tests);

  const runtimeBaseEnv = buildTestRuntimeEnv(process.env);
  const runtimeConfig = getRuntimeConfig(repoRoot, userConfig);
  const runtimeEnv = buildTestRuntimeEnv(resolveRuntimeEnv(runtimeConfig, runtimeBaseEnv));

  const results = [];
  for (const test of tests) {
    const result = runGateTest(test, runtimeEnv);
    results.push(result);
    if (result.status !== 'passed') break;
  }

  const failure = results.find((entry) => entry.status !== 'passed') || null;
  const diagnosticsPayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: failure ? 'error' : 'ok',
    repoRoot,
    metrics: {
      total: tests.length,
      executed: results.length,
      passed: results.filter((entry) => entry.status === 'passed').length,
      failed: results.filter((entry) => entry.status !== 'passed').length
    },
    failureReason: failure?.reason || null,
    results
  };

  const junitPath = await writeJUnit(argv.junit, results);
  const diagnosticsPath = await writeDiagnostics(argv.diagnostics, diagnosticsPayload);

  if (failure) {
    console.error(`lsp/embeddings gate failed: ${failure.label} (${failure.reason})`);
    if (junitPath) console.error(`lsp/embeddings gate junit: ${junitPath}`);
    if (diagnosticsPath) console.error(`lsp/embeddings gate diagnostics: ${diagnosticsPath}`);
    if (failure.reason === 'timeout') {
      process.exit(124);
    }
    exitLikeCommandResult({ status: failure.exitCode, signal: failure.signal });
  }

  console.error('lsp/embeddings gate tests passed');
  if (junitPath) console.error(`lsp/embeddings gate junit: ${junitPath}`);
  if (diagnosticsPath) console.error(`lsp/embeddings gate diagnostics: ${diagnosticsPath}`);
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
