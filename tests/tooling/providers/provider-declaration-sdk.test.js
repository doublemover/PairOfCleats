import assert from 'node:assert/strict';
import { providerDeclarationSchema, validateProviderDeclaration, checkProviderProvisioningConformance,
  migrateLegacyProviderDeclaration } from '../../../src/index/tooling/provider-declaration.js';
import { defineInProcessSemanticProvider } from '../../../src/index/tooling/provider-sdk.js';
import { validateToolingProvider } from '../../../src/index/tooling/provider-contract.js';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';

const declaration = { schemaVersion: 1, providerId: 'fixture-sdk', adapterVersion: '1', execution: 'trusted-inprocess',
  languages: [{ id: 'lua', dialect: 'LuaJIT' }], facts: [{ family: 'definitions', evidence: 'source-qualified' }],
  consumers: [{ id: 'semanticDetail', families: ['definitions'], partialPolicy: 'qualified', fallback: 'parser' }],
  contextRequirements: ['source-snapshot'], limits: { maxRequests: 4, maxFacts: 16, maxBytes: 65536, wallMs: 1000 }, prerequisites: [] };
const validate = compileSchema(createAjv({ strict: true, allErrors: true }), providerDeclarationSchema());
assert.equal(validate(declaration), true);
assert.equal(validateProviderDeclaration(declaration).ok, true);
for (const change of [{ schemaVersion: 2 }, { execution: 'unknown-callback' }, { limits: { ...declaration.limits, wallMs: 30001 } }]) {
  const value = { ...declaration, ...change };
  assert.equal(validate(value), false);
  assert.equal(validateProviderDeclaration(value).ok, false);
}
assert.equal(validateProviderDeclaration({ ...declaration, facts: [{ family: 'definitions', evidence: 'presentation' }] }).ok, false);
const provider = defineInProcessSemanticProvider({ declaration, produce: async () => ({ semanticFacts: {
  schemaVersion: 1, contexts: [], partitions: [], coverageRef: null, diagnosticsRef: null
} }) });
assert.equal(validateToolingProvider(provider), null);
assert.equal((await provider.run({ toolingConfig: {} }, {})).semanticFacts.partitions.length, 0);
const external = { ...declaration, execution: 'lsp', contextRequirements: ['source-snapshot', 'execution-grant'], prerequisites: [{
  id: 'lua-language-server', discovery: { strategy: 'path', candidates: ['lua-language-server'] },
  verify: { versionRange: 'qualified-profile', components: ['server'] },
  provision: { kind: 'recipe', recipeId: 'lua-official', supportedTargets: ['win32-x64'] },
  launch: { command: 'lua-language-server', args: [] }
}] };
assert.equal(checkProviderProvisioningConformance({ declaration: external, target: 'win32-x64', resolveRecipe: () => ({}) }).complete, false);
assert.equal(checkProviderProvisioningConformance({ declaration: external, target: 'unsupported' }).requirements[0].state, 'unsupported-target');
assert.equal(migrateLegacyProviderDeclaration({ id: 'old', version: '1', languages: ['lua'] }).status, 'requires-declaration');
console.log('provider declaration schema/SDK, unsupported versions and executable recipe conformance');
