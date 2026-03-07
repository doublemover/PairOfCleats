#!/usr/bin/env node
import assert from 'node:assert/strict';

import { __resolveAdaptiveLspScopePlanForTests } from '../../../src/integrations/tooling/providers/lsp.js';

const buildDoc = (index) => ({
  virtualPath: `.poc-vfs/src/doc-${String(index).padStart(4, '0')}.py#seg:doc-${index}.py`,
  languageId: 'python',
  text: `def fn_${index}():\n    return ${index}\n`
});

const buildClangdDoc = (index) => ({
  virtualPath: `.poc-vfs/src/doc-${String(index).padStart(4, '0')}.cc#seg:doc-${index}.cc`,
  languageId: 'cpp',
  text: `int fn_${index}() {\n  return ${index};\n}\n`
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
  docs: Array.from({ length: 20 }, (_, index) => buildClangdDoc(index)),
  targetsByPath: new Map(
    Array.from({ length: 20 }, (_, index) => [
      buildClangdDoc(index).virtualPath,
      [{ id: `${index}:0` }]
    ])
  ),
  hoverMaxPerFile: 3
});
assert.equal(uncappedPlan.docLimitApplied, false, 'expected small clangd inputs to avoid adaptive capping');
assert.equal(uncappedPlan.selectedDocs, 20, 'expected uncapped provider to keep all docs');
assert.equal(uncappedPlan.hoverMaxPerFile, 3, 'expected explicit hover max-per-file to pass through unchanged');

const targetHeavyDocs = Array.from({ length: 60 }, (_, index) => buildClangdDoc(index));
const targetHeavyTargetsByPath = new Map(
  targetHeavyDocs.map((doc, index) => [
    doc.virtualPath,
    Array.from({ length: 20 }, (_, targetIndex) => ({ id: `${index}:${targetIndex}` }))
  ])
);
const targetCappedPlan = __resolveAdaptiveLspScopePlanForTests({
  providerId: 'clangd',
  docs: targetHeavyDocs,
  targetsByPath: targetHeavyTargetsByPath,
  hoverMaxPerFile: null
});
assert.equal(targetCappedPlan.docLimitApplied, false, 'expected target-heavy clangd input to avoid doc-count capping');
assert.equal(targetCappedPlan.targetLimitApplied, true, 'expected clangd profile to cap by target count');
assert.equal(targetCappedPlan.selectedTargets <= 960, true, 'expected clangd target cap to bound selected targets');
assert.match(String(targetCappedPlan.reason || ''), /target-cap/, 'expected target cap reason to be recorded');

const goMixedDocs = [
  {
    virtualPath: '.poc-vfs/examples/go/go.mod',
    languageId: 'go',
    text: 'module example.com/demo\n'
  },
  {
    virtualPath: '.poc-vfs/examples/go/main.go',
    languageId: 'go',
    text: 'package main\nfunc main() {}\n'
  }
];
const goMixedTargetsByPath = new Map([
  [goMixedDocs[0].virtualPath, [{ id: 'module-target' }]],
  [goMixedDocs[1].virtualPath, [{ id: 'source-target' }]]
]);
const goMixedPlan = __resolveAdaptiveLspScopePlanForTests({
  providerId: 'gopls',
  docs: goMixedDocs,
  targetsByPath: goMixedTargetsByPath
});
assert.equal(goMixedPlan.totalDocs, 1, 'expected path policy to drop non-source go documents before adaptive planning');
assert.equal(goMixedPlan.selectedDocs, 1, 'expected only .go file to remain selectable');

console.log('LSP adaptive scope plan test passed');
