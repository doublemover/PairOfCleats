import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo,
  resolveLspFixtureCommand,
  runDedicatedProviderFixture
} from '../../../helpers/lsp-provider-fixture.js';

export const runDedicatedProviderMatrixCase = async ({
  root = process.cwd(),
  entry,
  providerConfig,
  configOverride = null
}) => {
  const tempRoot = await createLspProviderTempRepo({
    repoRoot: root,
    name: entry.fixtureName,
    directories: entry.directories,
    files: entry.files
  });
  const inputs = buildSingleSymbolInputs({
    scenarioName: entry.fixtureName,
    virtualPath: entry.virtualPath,
    text: entry.docText,
    languageId: entry.languageId,
    effectiveExt: entry.effectiveExt,
    symbolName: entry.symbolName
  });
  const resolvedProviderConfig = providerConfig || {
    cmd: resolveLspFixtureCommand(entry.fixtureCommand, { repoRoot: root })
  };
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: entry.providerId,
    providerConfigKey: entry.providerConfigKey,
    providerConfig: {
      ...resolvedProviderConfig,
      ...((configOverride && typeof configOverride === 'object') ? configOverride : {})
    },
    inputs
  });
  return { result, inputs };
};
