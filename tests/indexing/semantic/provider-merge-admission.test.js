import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const owner = new URL('../../../src/index/semantic/provider-merge-admission.js', import.meta.url).href;
const hooks = registerHooks({
  load(url, context, next) {
    const loaded = next(url, context);
    if (url !== owner + '?tiny-admission') return loaded;
    let source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
    for (const [before, after] of [['64 * 1024 * 1024', '2048'], ['32 * 1024 * 1024', '1024'], ['262144', '4'], ['4000000', '128']]) {
      assert.ok(source.includes(before), 'private fixture allowance must follow its actual owner'); source = source.replace(before, after);
    }
    return { ...loaded, source };
  }
});
try {
  const { createProviderMergeAdmission } = await import(owner + '?tiny-admission');
  const aggregate = createProviderMergeAdmission(), captured = aggregate.capture('λ'.repeat(1023));
  assert.equal(Buffer.byteLength(captured.canonical), 2048); assert.equal(captured.value, 'λ'.repeat(1023));
  assert.throws(() => aggregate.capture(null), error => error.code === 'ERR_SEMANTIC_PROVIDER_BUDGET' && error.allowance === 'aggregate-input-bytes');
  const originalParse = JSON.parse; let parsed = 0;
  JSON.parse = (...args) => { parsed++; return originalParse(...args); };
  try {
    const shared = Array(8).fill('x'.repeat(512));
    assert.throws(() => createProviderMergeAdmission().capture({ amplified: shared }), { code: 'ERR_SEMANTIC_JSON_BUDGET' });
    assert.equal(parsed, 0, 'logical repeated input is stopped before owned snapshot allocation');
  } finally { JSON.parse = originalParse; }
  const indices = createProviderMergeAdmission();
  indices.identity('😀'.repeat(255));
  assert.equal(indices.work.indexBytes, 1022);
  assert.throws(() => indices.visit(), error => error.code === 'ERR_SEMANTIC_PROVIDER_BUDGET' && error.allowance === 'prepared-index-bytes');
  const visits = createProviderMergeAdmission();
  for (let index = 0; index < 4; index++) visits.visit();
  assert.throws(() => visits.visit(), error => error.code === 'ERR_SEMANTIC_PROVIDER_BUDGET' && error.allowance === 'descriptor-visits');
  const structural = createProviderMergeAdmission();
  for (let index = 0; index < 128; index++) structural.check();
  assert.throws(() => structural.check(), error => error.code === 'ERR_SEMANTIC_PROVIDER_BUDGET' && error.allowance === 'structural-work');
  let getters = 0;
  const unsafe = Object.defineProperty({}, 'value', { enumerable: true, get() { getters++; return 1; } });
  assert.throws(() => createProviderMergeAdmission().capture(unsafe), /getters/u); assert.equal(getters, 0);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => createProviderMergeAdmission(controller.signal).capture({}), { name: 'AbortError' });
} finally { hooks.deregister(); }
console.log('Provider merge aggregate input, prepared index, descriptor and work admission precede expansion and preserve passive/cancellation controls.');
