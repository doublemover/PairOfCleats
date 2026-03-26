#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createToolingDoctorTempRoot,
  runToolingDoctorFixture
} from '../../helpers/tooling-doctor-fixture.js';

const cases = [
  {
    fixtureName: 'tooling-doctor-runtime-reqs-jdtls',
    providerId: 'jdtls',
    enabledTools: ['jdtls'],
    available: ['jdtls'],
    missing: ['java', 'javac'],
    expectedChecks: [
      { name: 'jdtls-runtime-java', status: 'error' },
      { name: 'jdtls-runtime-javac', status: 'error' }
    ]
  },
  {
    fixtureName: 'tooling-doctor-runtime-reqs-csharp',
    providerId: 'csharp-ls',
    enabledTools: ['csharp-ls'],
    available: ['csharp-ls'],
    missing: ['dotnet'],
    expectedChecks: [
      { name: 'csharp-ls-runtime-dotnet', status: 'error' }
    ]
  },
  {
    fixtureName: 'tooling-doctor-runtime-reqs-phpactor',
    providerId: 'phpactor',
    enabledTools: ['phpactor'],
    available: ['phpactor'],
    missing: ['php'],
    expectedChecks: [
      { name: 'phpactor-runtime-php', status: 'error' }
    ],
    absentChecks: ['phpactor-runtime-composer']
  },
  {
    fixtureName: 'tooling-doctor-runtime-reqs-java-csharp-php',
    providerId: 'lsp-java-dedicated',
    enabledTools: ['lsp-java-dedicated', 'lsp-csharp-dedicated', 'lsp-php-dedicated'],
    available: ['jdtls', 'csharp-ls', 'phpactor'],
    missing: ['java', 'dotnet', 'php'],
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
    expectedChecks: [
      { providerId: 'lsp-java-dedicated', name: 'lsp-java-dedicated-runtime-java', status: 'error' },
      { providerId: 'lsp-csharp-dedicated', name: 'lsp-csharp-dedicated-runtime-dotnet', status: 'error' },
      { providerId: 'lsp-php-dedicated', name: 'lsp-php-dedicated-runtime-php', status: 'error' }
    ],
    expectedSummaryStatus: 'error'
  },
  {
    fixtureName: 'tooling-doctor-runtime-reqs-dart',
    providerId: 'dart',
    enabledTools: ['dart'],
    available: ['dart'],
    reject: ({ cmd, args }) => cmd === 'dart' && args.length === 1 && args[0] === '--version',
    expectedChecks: [
      { name: 'dart-runtime-dart-sdk', status: 'error' }
    ]
  },
  {
    fixtureName: 'tooling-doctor-runtime-reqs-elixir',
    providerId: 'elixir-ls',
    enabledTools: ['elixir-ls'],
    available: ['elixir-ls'],
    missing: ['elixir', 'erl', 'mix'],
    expectedChecks: [
      { name: 'elixir-ls-runtime-elixir', status: 'error' },
      { name: 'elixir-ls-runtime-erl', status: 'error' },
      { name: 'elixir-ls-runtime-mix', status: 'error' }
    ]
  },
  {
    fixtureName: 'tooling-doctor-runtime-reqs-haskell',
    providerId: 'haskell-language-server',
    enabledTools: ['haskell-language-server'],
    available: ['haskell-language-server'],
    missing: ['ghc'],
    expectedChecks: [
      { name: 'haskell-language-server-runtime-ghc', status: 'error' }
    ]
  },
  {
    fixtureName: 'tooling-doctor-runtime-reqs-solargraph',
    providerId: 'solargraph',
    enabledTools: ['solargraph'],
    available: ['solargraph'],
    missing: ['ruby', 'gem', 'bundle'],
    expectedChecks: [
      { name: 'solargraph-runtime-ruby', status: 'error' },
      { name: 'solargraph-runtime-gem', status: 'error' },
      { name: 'solargraph-runtime-bundle', status: 'error' }
    ]
  }
];

for (const entry of cases) {
  const tempRoot = await createToolingDoctorTempRoot(entry.fixtureName);
  const resolveCommandProfile = createDoctorCommandResolver({
    available: entry.available,
    missing: entry.missing,
    reject: entry.reject
  });
  const report = await runToolingDoctorFixture({
    tempRoot,
    enabledTools: entry.enabledTools,
    toolingConfig: entry.toolingConfig || {},
    resolveCommandProfile
  });

  if (entry.expectedSummaryStatus) {
    assert.equal(report.summary.status, entry.expectedSummaryStatus, `expected summary status for ${entry.fixtureName}`);
  }

  for (const expectedCheck of entry.expectedChecks) {
    const providerId = expectedCheck.providerId || entry.providerId;
    const provider = (report.providers || []).find((providerEntry) => providerEntry.id === providerId);
    assert.ok(provider, `expected provider report for ${providerId}`);
    const check = (provider.checks || []).find((providerCheck) => providerCheck.name === expectedCheck.name);
    assert.ok(check, `expected runtime requirement check ${expectedCheck.name}`);
    assert.equal(check.status, expectedCheck.status, `expected ${expectedCheck.name} status`);
  }

  for (const checkName of entry.absentChecks || []) {
    const provider = (report.providers || []).find((providerEntry) => providerEntry.id === entry.providerId);
    const check = (provider?.checks || []).find((providerCheck) => providerCheck.name === checkName);
    assert.equal(check, undefined, `expected no ${checkName} runtime requirement check`);
  }
}

console.log('tooling doctor runtime requirements provider matrix test passed');
