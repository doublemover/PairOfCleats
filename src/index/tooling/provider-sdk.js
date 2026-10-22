import { assertProviderDeclaration } from './provider-declaration.js';
import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { hashProviderConfig } from './provider-contract.js';
import { createLspObservationCollector } from '../../integrations/tooling/providers/lsp/structured-observations.js';

/** Trusted in-process authors execute in the host process without an OS sandbox. */
export const defineInProcessSemanticProvider = ({ declaration, produce }) => {
  assertProviderDeclaration(declaration);
  if (declaration.execution !== 'trusted-inprocess' || typeof produce !== 'function') throw new TypeError('Expected a declared trusted in-process producer.');
  return { id: declaration.providerId, version: declaration.adapterVersion, declaration,
    profileContractVersion: 1, languages: declaration.languages.map(value => value.id), kinds: ['types'],
    capabilities: { types: declaration.facts.some(value => ['legacyTypes', 'symbolicTypes'].includes(value.family)),
      semanticFacts: true }, getConfigHash: ctx => hashProviderConfig(ctx.toolingConfig?.[declaration.providerId] || {}),
    async run(ctx, inputs) {
      const output = await produce(ctx, inputs);
      if (output?.semanticFacts !== undefined) assertSemanticEnvelope('provider', output.semanticFacts);
      return output;
    } };
};

/** The SDK's LSP mapping delegates protocol acquisition to the shared owner. */
export const createDeclaredLspCollector = ({ declaration, ...options }) => {
  assertProviderDeclaration(declaration);
  if (declaration.execution !== 'lsp') throw new TypeError('Expected an LSP provider declaration.');
  return createLspObservationCollector({ ...options, maxRequests: declaration.limits.maxRequests,
    maxFacts: declaration.limits.maxFacts, maxBytes: declaration.limits.maxBytes, maxMs: declaration.limits.wallMs });
};
