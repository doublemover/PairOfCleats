#!/usr/bin/env node
import assert from 'node:assert/strict';

import { __resolveAdaptiveLspScopePlanForTests } from '../../../src/integrations/tooling/providers/lsp.js';

const buildDoc = (index) => ({
  virtualPath: `.poc-vfs/src/doc-${String(index).padStart(4, '0')}.py#seg:doc-${index}.py`,
  languageId: 'python',
  text: `def fn_${index}():\n    return ${index}\n`
});

const docs = Array.from({ length: 500 }, (_, index) => buildDoc(index));
const targetsByPath = new Map(
  docs.map((doc, index) => [
    doc.virtualPath,
    Array.from({ length: index < 32 ? 4 : 1 }, (_, targetIndex) => ({ id: `${index}:${targetIndex}` }))
  ])
);

const cappedPlan = __resolveAdaptiveLspScopePlanForTests({
  providerId: 'pyright',
  docs,
  targetsByPath,
  documentSymbolConcurrency: 4,
  hoverMaxPerFile: null
});
assert.equal(cappedPlan.docLimitApplied, true, 'expected pyright profile to cap large document sets');
assert.equal(cappedPlan.selectedDocs, 384, 'expected pyright baseline cap to apply');
assert.equal(cappedPlan.hoverMaxPerFile, 8, 'expected capped plan to tighten hover budget to degraded cap');
assert.match(String(cappedPlan.reason || ''), /doc-cap/, 'expected capped scope reason to be recorded');
const retainedHotDocs = cappedPlan.documents.filter((doc) => String(doc.virtualPath).includes('doc-000'));
assert.ok(retainedHotDocs.length >= 8, 'expected high-target documents to survive the initial cap');

const degradedPlan = __resolveAdaptiveLspScopePlanForTests({
  providerId: 'pyright',
  docs,
  targetsByPath,
  documentSymbolConcurrency: 4,
  clientMetrics: {
    byMethod: {
      'textDocument/documentSymbol': {
        timedOut: 3,
        latencyMs: { p95: 3000 }
      }
    }
  },
  hoverMaxPerFile: 20
});
assert.equal(degradedPlan.degraded, true, 'expected repeated documentSymbol timeout pressure to degrade scope');
assert.equal(degradedPlan.selectedDocs, 192, 'expected degraded pyright cap to apply');
assert.equal(degradedPlan.hoverMaxPerFile, 8, 'expected degraded plan to clamp hover max-per-file');
assert.match(String(degradedPlan.reason || ''), /degraded-doc-cap/, 'expected degraded scope reason to be recorded');

const uncappedPlan = __resolveAdaptiveLspScopePlanForTests({
  providerId: 'clangd',
  docs: docs.slice(0, 20),
  targetsByPath,
  hoverMaxPerFile: 3
});
assert.equal(uncappedPlan.docLimitApplied, false, 'expected providers without a scope profile to leave docs untouched');
assert.equal(uncappedPlan.selectedDocs, 20, 'expected uncapped provider to keep all docs');
assert.equal(uncappedPlan.hoverMaxPerFile, 3, 'expected explicit hover max-per-file to pass through unchanged');

console.log('LSP adaptive scope plan test passed');
