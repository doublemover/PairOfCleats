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
  console.log('tree-sitter wasm unavailable; skipping tree-sitter-load bench contract.');
  process.exit(0);
}

const warmMax = Number(payload.warmMaxLoadedLanguages);
const thrashMax = Number(payload.thrashMaxLoadedLanguages);

const findScenario = ({ cacheMode, policy, maxLoadedLanguages }) => (
  scenarios.find((scenario) => (
    scenario
    && scenario.cacheMode === cacheMode
    && scenario.policy === policy
    && Number(scenario.maxLoadedLanguages) === Number(maxLoadedLanguages)
  )) || null
);

const cold = findScenario({ cacheMode: 'cold', policy: 'file-order', maxLoadedLanguages: warmMax });
const warm = findScenario({ cacheMode: 'warm', policy: 'file-order', maxLoadedLanguages: warmMax });
assert.ok(cold && !cold.skipped, 'expected cold warm/cold scenario');
assert.ok(warm && !warm.skipped, 'expected warm warm/cold scenario');

assert.ok(Number(cold.treeSitter?.wasmLoads) > 0, 'expected cold run to load grammars');
assert.equal(Number(warm.treeSitter?.wasmLoads), 0, 'expected warm run to avoid grammar loads');
assert.ok(
  Number.isFinite(Number(cold.totalMs)) && Number.isFinite(Number(warm.totalMs)),
  'expected warm/cold scenarios to report totalMs'
);
assert.ok(
  Number(warm.totalMs) < Number(cold.totalMs),
  `expected warm run to be faster than cold (warmMs=${warm.totalMs} coldMs=${cold.totalMs})`
);

const fileOrderThrash = findScenario({ cacheMode: 'cold', policy: 'file-order', maxLoadedLanguages: thrashMax });
const batchThrash = findScenario({ cacheMode: 'cold', policy: 'batch-by-language', maxLoadedLanguages: thrashMax });
assert.ok(fileOrderThrash && !fileOrderThrash.skipped, 'expected file-order thrash scenario');
assert.ok(batchThrash && !batchThrash.skipped, 'expected batch-by-language thrash scenario');

assert.ok(
  Number(fileOrderThrash.treeSitter?.wasmLoads) > Number(batchThrash.treeSitter?.wasmLoads),
  'expected batch-by-language to reduce redundant WASM loads under eviction pressure'
);

console.log('tree-sitter load bench contract test passed');
