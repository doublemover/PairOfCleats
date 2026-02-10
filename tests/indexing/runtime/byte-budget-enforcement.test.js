import assert from 'node:assert/strict';
import { applyByteBudget, resolveByteBudgetMap } from '../../../src/index/build/byte-budget.js';

const indexingConfig = {
  artifacts: {
    byteBudgetPolicy: {
      artifacts: {
        chunk_meta: { maxBytes: 100, overflow: 'fail', strict: true },
        symbol_edges: { maxBytes: 200, overflow: 'warn' }
      }
    }
  }
};

const { policies } = resolveByteBudgetMap({ indexingConfig, maxJsonBytes: 1000 });
const chunkMetaBudget = policies.chunk_meta;
const symbolEdgesBudget = policies.symbol_edges;

let threw = false;
try {
  applyByteBudget({
    budget: chunkMetaBudget,
    totalBytes: 250,
    label: 'chunk_meta',
    logger: () => {}
  });
} catch (err) {
  threw = err?.code === 'ERR_BYTE_BUDGET';
}
assert.ok(threw, 'expected strict byte budget to throw');

let warned = false;
applyByteBudget({
  budget: symbolEdgesBudget,
  totalBytes: 250,
  label: 'symbol_edges',
  logger: () => { warned = true; }
});
assert.ok(warned, 'expected warning budget to log');

console.log('byte budget enforcement test passed');
