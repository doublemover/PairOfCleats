import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ESLint } from 'eslint';
import { createLintAnalyzer } from '../../../src/index/lint-runtime.js';
import { createLintPolicy } from '../../../src/index/lint-policy.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('lint-real-session-costs');
const costs = [], calls = [];
class ObservedESLint extends ESLint {
  constructor(options) { const start = performance.now(); super(options); this.observedFiles = 0; costs.push({ kind: 'session-initialization', root: options.cwd, elapsedMs: performance.now() - start }); }
  async lintText(text, options) { const start = performance.now(); try { return await super.lintText(text, options); }
  finally { calls.push(options.filePath); costs.push({ kind: 'file', temperature: this.observedFiles++ ? 'warm' : 'first', root: path.dirname(options.filePath), elapsedMs: performance.now() - start }); } }
}
const roots = [path.join(dir, 'a'), path.join(dir, 'b')], text = 'export function sentinel() { return 1; missing(); }\n';
for (const root of roots) await fs.mkdir(root);
for (const order of [roots, roots.toReversed()]) {
  const analyze = createLintAnalyzer({ Eslint: ObservedESLint }), cache = new Map();
  for (const root of order) {
    const policy = createLintPolicy(root, root === roots[0] ? {} : { 'no-unreachable': 0 });
    const cold = await analyze(text, 'same.js', { root, policy, cache });
    const warm = await analyze(text, 'same.js', { root, policy, cache });
    assert.deepEqual(warm.receipt, cold.receipt); assert.equal(warm.cost.cacheHit, true);
    assert.equal(cold.receipt.clean, root !== roots[0]);
    const next = await analyze(text, 'same.js', { root, policy });
    assert.deepEqual(next.messages, cold.messages); assert.equal(next.receipt.policy.identity, policy.identity);
  }
}
assert.equal(costs.filter(row => row.kind === 'session-initialization').length, 4);
assert.equal(calls.length, 8, 'retained runtime warm work is distinct from result-cache replay');
assert.equal(costs.filter(row => row.temperature === 'first').length, 4);
assert.equal(costs.filter(row => row.temperature === 'warm').length, 4);
assert.ok(costs.every(row => Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0));
console.log(JSON.stringify({ basis: 'actual bounded ESLint calls; descriptive costs only, no latency or speedup threshold', costs }));
