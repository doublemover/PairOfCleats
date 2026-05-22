#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createStubLspCollectFixture } from './helpers/stub-lsp-collect-fixture.js';

const { chunkUid, collect } = await createStubLspCollectFixture('lsp-capability-gating');
const capabilityProbeOptions = {
  semanticTokensEnabled: false,
  inlayHintsEnabled: false
};
const withNoHover = await collect('no-hover', capabilityProbeOptions);

assert.ok(withNoHover.byChunkUid[chunkUid], 'expected enrichment to continue when hover capability is missing');
assert.equal(
  withNoHover.checks.some((check) => check?.name === 'tooling_capability_missing_hover'),
  true,
  'expected hover capability warning check'
);
assert.deepEqual(
  withNoHover.runtime?.capabilityGate?.missing,
  ['definition', 'hover', 'references', 'signatureHelp', 'typeDefinition'],
  'expected missing-capability list in runtime gate envelope'
);

const withoutDocumentSymbol = await collect('no-document-symbol', capabilityProbeOptions);

assert.equal(
  Object.keys(withoutDocumentSymbol.byChunkUid).length,
  0,
  'expected no enrichment when documentSymbol capability is absent'
);
assert.equal(
  withoutDocumentSymbol.checks.some((check) => check?.name === 'tooling_capability_missing_document_symbol'),
  true,
  'expected documentSymbol capability warning check'
);
assert.equal(
  withoutDocumentSymbol.runtime?.capabilities?.documentSymbol,
  false,
  'expected runtime capability mask to reflect missing documentSymbol support'
);
assert.equal(
  withoutDocumentSymbol.runtime?.capabilityGate?.effective?.documentSymbol,
  false,
  'expected capability gate to disable documentSymbol'
);

console.log('LSP capability probe gating test passed');
