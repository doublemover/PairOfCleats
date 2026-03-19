#!/usr/bin/env node
import assert from 'node:assert/strict';

import { __resolveAdaptiveLspRequestBudgetPlanForTests } from '../../../src/integrations/tooling/providers/lsp.js';

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

console.log('LSP request budget plan test passed');
