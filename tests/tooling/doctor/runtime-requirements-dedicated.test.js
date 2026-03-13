#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createToolingDoctorTempRoot,
  runToolingDoctorFixture
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-runtime-reqs');
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['jdtls', 'csharp-ls', 'phpactor'],
  missing: ['java', 'dotnet', 'php']
});

const providerIds = ['lsp-java-dedicated', 'lsp-csharp-dedicated', 'lsp-php-dedicated'];
const report = await runToolingDoctorFixture({
  tempRoot,
  enabledTools: providerIds,
  toolingConfig: {
    lsp: {
      enabled: true,
      servers: [
        { id: 'java-dedicated', cmd: 'jdtls', languages: ['java'] },
        { id: 'csharp-dedicated', cmd: 'csharp-ls', languages: ['csharp'] },
        { id: 'php-dedicated', cmd: 'phpactor', languages: ['php'] }
      ]
    }
  },
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
