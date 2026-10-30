import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import { applyRenderedTokenBudget, finalizeRenderedContextTransport } from '../../src/context-pack/rendered-token-budget.js';
import { contextTokenProjectionErrors } from '../../src/contracts/context-token-budget.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { createObservabilityEnvelope, attachObservability } from '../../src/shared/observability.js';
import { createContextTokenizerProfile } from '../helpers/context-tokenizer-profile.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
const { dir: root } = await prepareIsolatedTestCacheDir('context-token-transport');
await fs.writeFile(path.join(root, 'source.js'), 'a b abc');
const profile = await createContextTokenizerProfile(root);
const pack = assembleCompositeContextPack({ repoRoot: root, seed: { type: 'chunk', chunkUid: 'seed' },
  chunkMeta: [{ chunkUid: 'seed', file: 'source.js', start: 0, end: 7 }], includeGraph: false,
  indexSignature: 'fixed-generation', now: () => '2026-10-28T00:00:00.000Z' });
const counted = await applyRenderedTokenBudget(pack, profile.policy, { repoRoot: root });
counted.publish();
const observability = createObservabilityEnvelope({ surface: 'analysis', operation: 'context_pack',
  correlation: { requestId: 'actual-request' }, at: '2026-10-28T00:00:00.000Z' });
const decorated = attachObservability(counted.payload, observability);
assert.ok(contextTokenProjectionErrors(decorated).includes('Context payload changed after token accounting.'),
  'the existing digest must continue detecting decoration outside its owner');
const projected = finalizeRenderedContextTransport(counted.payload, decorated);
assert.deepEqual(contextTokenProjectionErrors(projected), []);
const checked = validateCompositeContextPack(projected);
assert.equal(checked.ok, true, checked.errors.join('; '));
assert.equal(projected.tokenAccounting.renderedTokens, counted.payload.tokenAccounting.renderedTokens);
assert.equal(projected.renderedContext, counted.payload.renderedContext);
assert.notEqual(projected.tokenAccounting.payloadSha256, counted.payload.tokenAccounting.payloadSha256);
assert.deepEqual(projected.observability, observability);
assert.equal(counted.payload.observability, undefined, 'decoration cannot mutate the originally counted payload');
assert.throws(() => finalizeRenderedContextTransport(structuredClone(counted.payload), decorated), { code: 'ERR_CONTEXT_PACK_SCHEMA' });
assert.throws(() => finalizeRenderedContextTransport(counted.payload,
  { ...decorated, primary: { ...decorated.primary, excerpt: 'changed source' } }), { code: 'ERR_CONTEXT_PACK_SCHEMA' });
assert.throws(() => finalizeRenderedContextTransport(counted.payload, { ...decorated, newSourceField: 'unaccounted' }),
  { code: 'ERR_CONTEXT_PACK_SCHEMA' });
assert.throws(() => finalizeRenderedContextTransport(counted.payload,
  { ...decorated, observability: { ...observability, context: { excessive: 'x'.repeat(256 * 1024) } } }),
{ code: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET' });
const receipt = counted.payload.tokenAccounting;
receipt.renderedTokens++; receipt.admittedTokens++;
assert.throws(() => finalizeRenderedContextTransport(counted.payload, decorated), { code: 'ERR_CONTEXT_PACK_SCHEMA' },
  'mutating a receipt cannot forge the original count capability');
console.log('MCP invocation decoration preserves strict token/source identity under the original completed count');
