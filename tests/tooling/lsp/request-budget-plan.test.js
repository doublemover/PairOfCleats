#!/usr/bin/env node
import assert from 'node:assert/strict';

import { __resolveAdaptiveLspRequestBudgetPlanForTests } from '../../../src/integrations/tooling/providers/lsp.js';
import { createDefinitionBudgetControllers } from '../../../src/integrations/tooling/providers/lsp/request-budget.js';

const baseline = __resolveAdaptiveLspRequestBudgetPlanForTests({
  providerId: 'pyright',
  workspaceKey: 'repo-root',
  selection: {
    selectedDocs: 24,
    selectedTargets: 96,
    hoverMaxPerFile: 4
  },
  clientMetrics: {
    byMethod: {
      'textDocument/hover': {
        requests: 20,
        failed: 1,
        timedOut: 0,
        latencyMs: { p95: 900 }
      }
    }
  },
  lifecycleState: {
    crashLoopQuarantined: false,
    fdPressureBackoffActive: false
  },
  guardState: {
    tripCount: 0
  }
});

assert.equal(baseline.providerId, 'pyright');
assert.equal(baseline.workspaceKey, 'repo-root');
assert.equal(baseline.byKind.documentSymbol.maxRequests > 0, true, 'expected documentSymbol budget');
assert.equal(baseline.byKind.hover.maxRequests > 0, true, 'expected hover budget');
assert.equal(
  baseline.byKind.signatureHelp.maxRequests < baseline.byKind.hover.maxRequests,
  true,
  'expected separate signatureHelp budget below hover budget'
);
assert.equal(
  baseline.byKind.references.maxRequests < baseline.byKind.definition.maxRequests,
  true,
  'expected references budget to be tighter than definition budget'
);

const degraded = __resolveAdaptiveLspRequestBudgetPlanForTests({
  providerId: 'pyright',
  workspaceKey: 'repo-root',
  selection: {
    selectedDocs: 24,
    selectedTargets: 96,
    hoverMaxPerFile: 4
  },
  clientMetrics: {
    byMethod: {
      'textDocument/hover': {
        requests: 10,
        failed: 4,
        timedOut: 3,
        latencyMs: { p95: 3200 }
      },
      'textDocument/signatureHelp': {
        requests: 8,
        failed: 3,
        timedOut: 2,
        latencyMs: { p95: 2800 }
      }
    }
  },
  lifecycleState: {
    crashLoopQuarantined: false,
    fdPressureBackoffActive: true
  },
  guardState: {
    tripCount: 1
  }
});

assert.equal(degraded.degraded, true, 'expected degraded budget plan');
assert.equal(
  degraded.byKind.hover.maxRequests < baseline.byKind.hover.maxRequests,
  true,
  'expected hover budget to tighten under pressure'
);
assert.equal(
  degraded.byKind.signatureHelp.maxRequests < baseline.byKind.signatureHelp.maxRequests,
  true,
  'expected signatureHelp budget to tighten under pressure'
);
assert.equal(
  degraded.byKind.hover.reasonCodes.includes('timeout_pressure'),
  true,
  'expected timeout pressure reason'
);
assert.equal(
  degraded.byKind.hover.reasonCodes.includes('breaker_or_quarantine'),
  true,
  'expected lifecycle pressure reason'
);

const semanticSelection = { selectedDocs: 1, selectedTargets: 3, hoverMaxPerFile: 4, semanticDefinitionTargets: 3 };
const semantic = __resolveAdaptiveLspRequestBudgetPlanForTests({ providerId: 'clangd', selection: semanticSelection });
assert.equal(semantic.byKind.definition.maxRequests, 3, 'Admitted definitions are funded before optional enrichment.');
const weights = { documentSymbol: 1, hover: 1, semanticTokens: 0.8, signatureHelp: 1.1,
  inlayHints: 0.9, definition: 1.4, typeDefinition: 1.5, references: 1.8 };
const allocatedCost = plan => Object.entries(plan.byKind).reduce((sum, [kind, value]) => sum + weights[kind] * value.maxRequests, 0);
assert.ok(allocatedCost(semantic) <= semantic.workspaceCostCeiling, 'Reservations never increase the workspace cost cap.');
const constrained = __resolveAdaptiveLspRequestBudgetPlanForTests({ providerId: 'clangd',
  selection: { ...semanticSelection, selectedTargets: 0 } });
assert.ok(constrained.byKind.definition.maxRequests < 3, 'An unfunded definition remains deferred.');
assert.ok(allocatedCost(constrained) <= constrained.workspaceCostCeiling);
const semanticPressure = __resolveAdaptiveLspRequestBudgetPlanForTests({ providerId: 'clangd', selection: semanticSelection,
  clientMetrics: { byMethod: { 'textDocument/definition': { requests: 4, failed: 3, timedOut: 2 } } } });
assert.ok(semanticPressure.byKind.definition.maxRequests < 3, 'Health pressure can reduce the semantic reservation.');
const quarantined = __resolveAdaptiveLspRequestBudgetPlanForTests({ providerId: 'clangd', selection: semanticSelection,
  lifecycleState: { crashLoopQuarantined: true } });
assert.equal(quarantined.byKind.definition.maxRequests, 0, 'Quarantine refuses admitted definitions.');
assert.equal(quarantined.byKind.definition.semanticMaxRequests, 0);
for (const plan of [semantic, constrained, semanticPressure, quarantined]) {
  const controllers = createDefinitionBudgetControllers(plan.byKind.definition);
  assert.equal(controllers.definition.maxRequests + controllers.semanticDefinition.maxRequests,
    plan.byKind.definition.maxRequests, 'Shared document controllers partition the existing health-reduced cap.');
  while (controllers.definition.tryReserve()) { /* An earlier document exhausts optional requests. */ }
  for (let index = 0; index < plan.byKind.definition.semanticMaxRequests; index += 1) {
    assert.equal(controllers.semanticDefinition.tryReserve(), true, 'Other documents cannot spend a semantic reservation.');
  }
  assert.equal(controllers.semanticDefinition.tryReserve(), false);
  assert.ok(controllers.definition.used + controllers.semanticDefinition.used <= plan.byKind.definition.maxRequests);
}

console.log('LSP request budget plan test passed');
