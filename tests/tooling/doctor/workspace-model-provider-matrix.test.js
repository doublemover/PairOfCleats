#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDoctorCommandResolver,
  createDoctorRunner,
  createToolingDoctorTempRoot,
  writeDoctorWorkspaceMarker
} from '../../helpers/tooling-doctor-fixture.js';

const cases = [
  {
    fixtureName: 'tooling-doctor-workspace-java-dedicated',
    providerId: 'lsp-java-dedicated',
    available: ['jdtls'],
    enabledTools: ['lsp-java-dedicated'],
    toolingConfig: {
      lsp: {
        enabled: true,
        servers: [
          { id: 'java-dedicated', cmd: 'jdtls', languages: ['java'] }
        ]
      }
    },
    checkName: 'lsp-java-dedicated-workspace-model'
  },
  {
    fixtureName: 'tooling-doctor-workspace-dart',
    providerId: 'dart',
    available: ['dart'],
    enabledTools: ['dart'],
    checkName: 'dart-workspace-model'
  },
  {
    fixtureName: 'tooling-doctor-workspace-elixir',
    providerId: 'elixir-ls',
    available: ['elixir-ls'],
    enabledTools: ['elixir-ls'],
    checkName: 'elixir-ls-workspace-model'
  },
  {
    fixtureName: 'tooling-doctor-workspace-haskell',
    providerId: 'haskell-language-server',
    available: ['haskell-language-server'],
    enabledTools: ['haskell-language-server'],
    checkName: 'haskell-language-server-workspace-model'
  },
  {
    fixtureName: 'tooling-doctor-workspace-phpactor',
    providerId: 'phpactor',
    available: ['phpactor'],
    enabledTools: ['phpactor'],
    checkName: 'phpactor-workspace-model'
  },
  {
    fixtureName: 'tooling-doctor-workspace-solargraph',
    providerId: 'solargraph',
    available: ['solargraph'],
    enabledTools: ['solargraph'],
    checkName: 'solargraph-workspace-model'
  },
  {
    fixtureName: 'tooling-doctor-workspace-csharp',
    providerId: 'csharp-ls',
    available: ['csharp-ls'],
    enabledTools: ['csharp-ls'],
    checkName: 'csharp-ls-workspace-model'
  }
];

for (const entry of cases) {
  const tempRoot = await createToolingDoctorTempRoot(entry.fixtureName);
  const resolveCommandProfile = createDoctorCommandResolver({
    available: entry.available
  });
  const { runDoctor } = createDoctorRunner({
    tempRoot,
    enabledTools: entry.enabledTools,
    toolingConfig: entry.toolingConfig || {},
    resolveCommandProfile
  });

  const reportMissingMarkers = await runDoctor();
  const providerMissing = (reportMissingMarkers.providers || []).find((provider) => provider.id === entry.providerId);
  const missingCheck = (providerMissing?.checks || []).find((check) => check.name === entry.checkName);
  assert.ok(missingCheck, `expected workspace-model check for ${entry.providerId}`);
  assert.equal(missingCheck.status, 'warn', `expected warn when workspace markers are missing for ${entry.providerId}`);

  await writeDoctorWorkspaceMarker(tempRoot, entry.providerId);
  const reportWithMarkers = await runDoctor();
  const providerPresent = (reportWithMarkers.providers || []).find((provider) => provider.id === entry.providerId);
  const presentCheck = (providerPresent?.checks || []).find((check) => check.name === entry.checkName);
  assert.ok(presentCheck, `expected workspace-model check after marker creation for ${entry.providerId}`);
  assert.equal(presentCheck.status, 'ok', `expected ok when workspace markers are present for ${entry.providerId}`);
}

console.log('tooling doctor workspace model provider matrix test passed');
