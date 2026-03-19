#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const providerPath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp.js');
const scopePlanPath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'scope-plan.js');
const requestBudgetPath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'request-budget.js');

for (const target of [providerPath, scopePlanPath, requestBudgetPath]) {
  assert.equal(fs.existsSync(target), true, `missing expected LSP runtime modularization file: ${target}`);
}

const providerSource = fs.readFileSync(providerPath, 'utf8');

for (const marker of [
  "./lsp/scope-plan.js",
  "./lsp/request-budget.js",
  'createBudgetController(',
  'createEmptyRequestCacheMetrics(',
  'summarizeRequestCacheMetrics(',
  '__resolveAdaptiveLspScopePlanForTests(',
  '__resolveAdaptiveLspRequestBudgetPlanForTests('
]) {
  assert.equal(
    providerSource.includes(marker),
    true,
    `expected LSP provider runtime to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'const resolveAdaptiveLspScopePlanForTests = ({',
  'const resolveProviderConfidenceBias = ({',
  'const createBudgetController = (maxRequests) => {',
  'const summarizeRequestCacheMetrics = (metrics) => ({'
]) {
  assert.equal(
    providerSource.includes(legacyInlineMarker),
    false,
    `expected LSP provider runtime to stop inlining ${legacyInlineMarker}`
  );
}

console.log('LSP provider runtime modularization test passed');
