#!/usr/bin/env node
import assert from 'node:assert/strict';

import { __resolvePyrightRequestPlanForTests } from '../../../src/index/tooling/pyright-planner.js';

const buildDoc = (virtualPath, text, languageId = 'python') => ({
  virtualPath,
  text,
  languageId,
  effectiveExt: languageId === 'python' ? '.py' : '.txt'
});

const buildTarget = (virtualPath, id) => ({
  virtualPath,
  chunkRef: {
    chunkUid: `ck:${id}`,
    chunkId: `chunk:${id}`,
    file: virtualPath.replace(/^\.poc-vfs\//u, '').replace(/#.*$/u, '')
  }
});

const docs = [
  buildDoc('.poc-vfs/pkg-a/src/core.py#seg:core', 'class Core:\n    pass\n\ndef alpha():\n    return 1\n'),
  buildDoc('.poc-vfs/pkg-a/src/helpers.py#seg:helpers', 'def helper():\n    return 2\n'),
  buildDoc('.poc-vfs/pkg-a/tests/test_core.py#seg:test_core', 'def test_core():\n    assert True\n'),
  buildDoc('.poc-vfs/pkg-b/src/other.py#seg:other', 'def other():\n    return 3\n'),
  buildDoc('.poc-vfs/src/native.cc#seg:native', 'int native() { return 1; }\n', 'cpp')
];

const targets = [
  buildTarget('.poc-vfs/pkg-a/src/core.py#seg:core', 'core:0'),
  buildTarget('.poc-vfs/pkg-a/src/core.py#seg:core', 'core:1'),
  buildTarget('.poc-vfs/pkg-a/src/helpers.py#seg:helpers', 'helpers:0'),
  buildTarget('.poc-vfs/pkg-a/tests/test_core.py#seg:test_core', 'test:0'),
  buildTarget('.poc-vfs/pkg-b/src/other.py#seg:other', 'other:0')
];

const baselinePlan = __resolvePyrightRequestPlanForTests({
  repoRoot: process.cwd(),
  documents: docs.filter((doc) => doc.languageId === 'python'),
  targets,
  allDocuments: docs,
  workspaceRootByVirtualPath: {
    '.poc-vfs/pkg-a/src/core.py#seg:core': 'pkg-a',
    '.poc-vfs/pkg-a/src/helpers.py#seg:helpers': 'pkg-a',
    '.poc-vfs/pkg-a/tests/test_core.py#seg:test_core': 'pkg-a',
    '.poc-vfs/pkg-b/src/other.py#seg:other': 'pkg-b'
  }
});

assert.equal(baselinePlan.workspaceRootRel, 'pkg-a', 'expected pyright to narrow to the dominant workspace root');
assert.equal(
  baselinePlan.selectedDocuments.some((doc) => String(doc.virtualPath).includes('pkg-b/src/other.py')),
  false,
  'expected mismatched workspace documents to be skipped'
);
assert.equal(
  baselinePlan.selectedDocuments.some((doc) => String(doc.virtualPath).includes('pkg-a/tests/test_core.py')),
  false,
  'expected low-value test documents to be skipped'
);
assert.equal(
  baselinePlan.diagnostics.countsByReason.workspace_mismatch >= 1,
  true,
  'expected workspace mismatch count'
);
assert.equal(
  baselinePlan.diagnostics.countsByReason.path_policy_low_value >= 1,
  true,
  'expected path policy low-value count'
);
assert.equal(
  baselinePlan.documentSymbolConcurrency <= 3,
  true,
  'expected mixed-language pressure to tighten pyright concurrency'
);

const pressureDocs = Array.from({ length: 80 }, (_, index) => buildDoc(
  `.poc-vfs/pkg-a/src/module-${String(index).padStart(3, '0')}.py#seg:module-${index}`,
  `def fn_${index}():\n    return ${index}\n`
));
const pressureTargets = pressureDocs.map((doc, index) => buildTarget(doc.virtualPath, `pressure:${index}`));
const pressuredPlan = __resolvePyrightRequestPlanForTests({
  repoRoot: process.cwd(),
  documents: pressureDocs,
  targets: pressureTargets,
  allDocuments: pressureDocs,
  persistedHealth: {
    workspaceRootRel: 'pkg-a',
    documentSymbolTimeouts: 3,
    documentSymbolFailures: 4,
    documentSymbolP95Ms: 3200
  },
  workspaceRootByVirtualPath: Object.fromEntries(
    pressureDocs.map((doc) => [doc.virtualPath, 'pkg-a'])
  )
});

assert.equal(pressuredPlan.healthLevel, 'severe', 'expected persisted pyright health to classify as severe');
assert.equal(pressuredPlan.documentSymbolConcurrency, 1, 'expected severe health pressure to force serial documentSymbol planning');
assert.equal(pressuredPlan.selectedDocuments.length <= 24, true, 'expected severe health pressure to cap selected docs aggressively');
assert.equal(
  pressuredPlan.diagnostics.countsByReason.budget_capped >= 1,
  true,
  'expected planner to record budget-capped documents under health pressure'
);

console.log('pyright request planner test passed');
