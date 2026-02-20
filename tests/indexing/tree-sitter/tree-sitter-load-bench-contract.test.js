#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const benchScript = path.join(root, 'tools', 'bench', 'index', 'tree-sitter-load.js');

const result = spawnSync(
  process.execPath,
  [
    benchScript,
    '--languages',
    'javascript,go,rust',
    '--files-per-language',
    '10',
    '--repeats',
    '1',
    '--json'
  ],
  { cwd: root, env: process.env, encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  process.exit(result.status ?? 1);
}

const payload = JSON.parse(String(result.stdout || '{}'));
const scenarios = Array.isArray(payload.scenarios) ? payload.scenarios : [];
assert.equal(scenarios.length, 4, 'expected 4 scenarios');

if (scenarios.every((scenario) => scenario && scenario.skipped)) {
  console.log('tree-sitter runtime unavailable; skipping tree-sitter-load bench contract.');
  process.exit(0);
}

const findScenario = ({ cacheMode, policy }) => (
  scenarios.find((scenario) => (
    scenario
    && scenario.cacheMode === cacheMode
    && scenario.policy === policy
  )) || null
);

const cold = findScenario({ cacheMode: 'cold', policy: 'file-order' });
const warm = findScenario({ cacheMode: 'warm', policy: 'file-order' });
assert.ok(cold && !cold.skipped, 'expected cold warm/cold scenario');
assert.ok(warm && !warm.skipped, 'expected warm warm/cold scenario');

assert.ok(Number(cold.treeSitter?.grammarLoads) > 0, 'expected cold run to load grammars');
assert.equal(Number(warm.treeSitter?.grammarLoads), 0, 'expected warm run to avoid grammar loads');
assert.ok(
  Number.isFinite(Number(cold.totalMs)) && Number.isFinite(Number(warm.totalMs)),
  'expected warm/cold scenarios to report totalMs'
);
const coldMs = Number(cold.totalMs);
const warmMs = Number(warm.totalMs);
assert.ok(
  warmMs <= (coldMs * 1.35),
  `expected warm run to avoid major regression vs cold (warmMs=${warmMs} coldMs=${coldMs})`
);

const fileOrderCold = findScenario({ cacheMode: 'cold', policy: 'file-order' });
const batchCold = findScenario({ cacheMode: 'cold', policy: 'batch-by-language' });
assert.ok(fileOrderCold && !fileOrderCold.skipped, 'expected cold file-order scenario');
assert.ok(batchCold && !batchCold.skipped, 'expected cold batch-by-language scenario');

assert.ok(
  Number(fileOrderCold.treeSitter?.parserActivations) >= Number(batchCold.treeSitter?.parserActivations),
  'expected batch-by-language to avoid extra parser language switching'
);

console.log('tree-sitter load bench contract test passed');

