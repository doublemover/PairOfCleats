#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-runtime-reqs-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const shouldResolve = new Set(['jdtls', 'csharp-ls', 'phpactor']);
const missingDependencies = new Set(['java', 'dotnet', 'php']);
const resolveCommandProfile = ({ cmd, args = [] }) => {
  const normalized = String(cmd || '').trim().toLowerCase();
  const ok = shouldResolve.has(normalized) || !missingDependencies.has(normalized);
  return {
    requested: { cmd, args },
    resolved: {
      cmd,
      args,
      mode: 'direct',
      source: 'mock'
    },
    probe: {
      ok,
      attempted: [{ cmd, args }],
      resolvedPath: ok ? String(cmd) : null
    }
  };
};

const providerIds = ['lsp-java-dedicated', 'lsp-csharp-dedicated', 'lsp-php-dedicated'];
const report = await runToolingDoctor({
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: providerIds,
    lsp: {
      enabled: true,
      servers: [
        { id: 'java-dedicated', cmd: 'jdtls', languages: ['java'] },
        { id: 'csharp-dedicated', cmd: 'csharp-ls', languages: ['csharp'] },
        { id: 'php-dedicated', cmd: 'phpactor', languages: ['php'] }
      ]
    }
  },
  strict: false
}, providerIds, {
  log: () => {},
  probeHandshake: false,
  resolveCommandProfile
});

const findProvider = (id) => (report.providers || []).find((entry) => entry.id === id);

const javaProvider = findProvider('lsp-java-dedicated');
assert.ok(javaProvider, 'expected java dedicated provider report');
const javaRuntimeCheck = (javaProvider.checks || []).find((check) => check.name === 'lsp-java-dedicated-runtime-java');
assert.ok(javaRuntimeCheck, 'expected java runtime requirement check');
assert.equal(javaRuntimeCheck.status, 'error', 'expected java runtime check error when java command missing');

const csharpProvider = findProvider('lsp-csharp-dedicated');
assert.ok(csharpProvider, 'expected csharp dedicated provider report');
const dotnetRuntimeCheck = (csharpProvider.checks || []).find((check) => check.name === 'lsp-csharp-dedicated-runtime-dotnet');
assert.ok(dotnetRuntimeCheck, 'expected dotnet runtime requirement check');
assert.equal(dotnetRuntimeCheck.status, 'error', 'expected dotnet runtime check error when dotnet command missing');

const phpProvider = findProvider('lsp-php-dedicated');
assert.ok(phpProvider, 'expected php dedicated provider report');
const phpRuntimeCheck = (phpProvider.checks || []).find((check) => check.name === 'lsp-php-dedicated-runtime-php');
assert.ok(phpRuntimeCheck, 'expected php runtime requirement check');
assert.equal(phpRuntimeCheck.status, 'error', 'expected php runtime check error when php command missing');

assert.equal(report.summary.status, 'error', 'expected doctor summary error with missing dedicated runtimes');

console.log('tooling doctor dedicated runtime requirements test passed');
