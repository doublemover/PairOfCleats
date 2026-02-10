#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_BYTE_BUDGETS,
  resolveByteBudgetMap
} from '../../../src/index/build/byte-budget.js';

const resolved = resolveByteBudgetMap({
  indexingConfig: {},
  maxJsonBytes: 1024
});

for (const [artifact, policy] of Object.entries(DEFAULT_BYTE_BUDGETS)) {
  const resolvedPolicy = resolved.policies[artifact];
  assert.ok(resolvedPolicy, `missing resolved policy for ${artifact}`);
  assert.equal(resolvedPolicy.maxBytes, 1024, `${artifact} should default maxBytes to maxJsonBytes`);
  assert.equal(resolvedPolicy.overflow, policy.overflow, `${artifact} overflow should match runtime default`);
  assert.equal(resolvedPolicy.strict, false, `${artifact} strict should default to false`);
}

const specPath = path.join(process.cwd(), 'docs', 'specs', 'byte-budget-policy.md');
const specText = await fs.readFile(specPath, 'utf8');
const docBudgetLines = specText
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^- [a-z_]+: maxJsonBytes, overflow=[a-z]+$/i.test(line));

const docMap = new Map();
for (const line of docBudgetLines) {
  const match = line.match(/^- ([a-z_]+): maxJsonBytes, overflow=([a-z]+)$/i);
  if (!match) continue;
  docMap.set(match[1], match[2].toLowerCase());
}

for (const [artifact, policy] of Object.entries(DEFAULT_BYTE_BUDGETS)) {
  assert.equal(
    docMap.get(artifact),
    policy.overflow,
    `docs budget table overflow mismatch for ${artifact}`
  );
}

console.log('byte budget default policy test passed');
