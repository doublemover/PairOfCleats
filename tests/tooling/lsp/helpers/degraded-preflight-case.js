import assert from 'node:assert/strict';
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo,
  resolveLspFixtureCommand,
  runDedicatedProviderFixture
} from '../../../helpers/lsp-provider-fixture.js';
import { withLspTestPath } from '../../../helpers/lsp-runtime.js';

const assertWarningCheck = ({ checks, checkName, message }) => {
  const normalizedChecks = Array.isArray(checks) ? checks : [];
  assert.equal(
    normalizedChecks.some((check) => check?.name === checkName),
    true,
    message
  );
};

export const runDedicatedProviderDegradedPreflightCase = async ({
  root = process.cwd(),
  repo,
  providerId,
  providerConfigKey,
  fixtureCommand,
  inputs,
  expectedEnrichment,
  expectedReasonCode,
  expectedCheckName,
  diagnosticsKey = providerId,
  messages
}) => {
  const fixtureCmd = resolveLspFixtureCommand(fixtureCommand, { repoRoot: root });
  await withLspTestPath({ repoRoot: root }, async () => {
    const result = await runDedicatedProviderFixture({
      tempRoot: repo,
      providerId,
      providerConfigKey,
      providerConfig: {
        cmd: fixtureCmd
      },
      inputs
    });

    assert.equal(
      result.byChunkUid.has(inputs.chunkUid),
      expectedEnrichment,
      messages?.enrichment
    );
    const diagnostics = result.diagnostics?.[diagnosticsKey] || {};
    assert.equal(
      diagnostics?.preflight?.state,
      'degraded',
      messages?.state || `expected ${providerId} preflight degraded state`
    );
    assert.equal(
      diagnostics?.preflight?.reasonCode,
      expectedReasonCode,
      messages?.reasonCode
    );
    assertWarningCheck({
      checks: diagnostics?.checks,
      checkName: expectedCheckName,
      message: messages?.check
    });
  });
};

export const runSingleSymbolDegradedPreflightCase = async ({
  root = process.cwd(),
  name,
  directories,
  files,
  providerId,
  providerConfigKey,
  fixtureCommand,
  providerConfig = {},
  input,
  expectedReasonCode,
  expectedCheckName,
  expectedEnrichment = true,
  diagnosticsKey = providerId,
  messages
}) => {
  const tempRoot = await createLspProviderTempRepo({
    repoRoot: root,
    name,
    directories,
    files
  });
  const inputs = buildSingleSymbolInputs(input);
  const fixtureCmd = resolveLspFixtureCommand(fixtureCommand, { repoRoot: root });
  await withLspTestPath({ repoRoot: root }, async () => {
    const result = await runDedicatedProviderFixture({
      tempRoot,
      providerId,
      providerConfigKey,
      providerConfig: {
        ...providerConfig,
        cmd: fixtureCmd
      },
      inputs
    });

    assert.equal(
      result.byChunkUid.has(inputs.chunkUid),
      expectedEnrichment,
      messages?.enrichment
    );
    const diagnostics = result.diagnostics?.[diagnosticsKey] || {};
    assert.equal(
      diagnostics?.preflight?.state,
      'degraded',
      messages?.state || `expected ${providerId} preflight degraded state`
    );
    assert.equal(
      diagnostics?.preflight?.reasonCode,
      expectedReasonCode,
      messages?.reasonCode
    );
    assertWarningCheck({
      checks: diagnostics?.checks,
      checkName: expectedCheckName,
      message: messages?.check
    });
  });
};
