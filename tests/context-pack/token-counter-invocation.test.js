import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createContextTokenizerProfile } from '../helpers/context-tokenizer-profile.js';
import { withRenderedContextTokenCounter } from '../../src/context-pack/token-counter.js';

// UNVALIDATED: one real bounded pure-JS worker, actual profile verification,
// original teardown and private scalar publication. No model/backend fallback.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['reuse', 'retired', 'ignored-operation', 'ignored-failure', 'publish-before-close', 'action-error', 'pre-cancel', 'limit', 'nested'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'counter-scope-'));
try {
  const { policy } = await createContextTokenizerProfile(root);
  const input = { policy, repoRoot: root, taskPolicy: { fixture: selected } };
  let held;
  if (selected === 'pre-cancel') {
    const controller = new AbortController(); controller.abort(new Error('before admission'));
    await assert.rejects(withRenderedContextTokenCounter({ ...input, signal: controller.signal }, () => assert.fail('cancelled counter cannot start')),
      { code: 'ABORT_ERR' });
  } else if (selected === 'action-error') {
    const failure = Object.freeze(Object.assign(new Error('actual selector failure'), { code: 'ERR_SELECTOR_FIXTURE', status: 409 }));
    await assert.rejects(withRenderedContextTokenCounter(input, () => { throw failure; }), error =>
      error.code === failure.code && error.status === 409 && error.cause === failure);
  } else if (selected === 'ignored-failure') {
    await assert.rejects(withRenderedContextTokenCounter(input, counter => {
      counter.count('x'.repeat(131073)).catch(() => {});
      return 'a discarded failed operation cannot become a successful scope';
    }), { code: 'ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE' });
  } else if (selected === 'limit') {
    await assert.rejects(withRenderedContextTokenCounter(input, async counter => {
      for (let index = 0; index < 128; index++) assert.equal((await counter.count('a')).tokens, 1);
      await assert.rejects(counter.count('a'), { code: 'ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE' });
    }), { code: 'ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE' });
  } else if (selected === 'nested') {
    await withRenderedContextTokenCounter(input, async counter => {
      await assert.rejects(withRenderedContextTokenCounter(input, () => assert.fail('nested worker cannot be admitted')),
        { code: 'ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE' });
      assert.equal((await counter.count('a b')).tokens, 2);
    });
  } else if (selected === 'ignored-operation') {
    let pending;
    assert.equal(await withRenderedContextTokenCounter(input, counter => { held = counter; pending = counter.count('a b'); return 42; }), 42);
    const counted = await pending; assert.equal(counted.tokens, 2); counted.publish();
    assert.equal(held.stats().profileLoads, 1);
    await assert.rejects(held.count('abc'), { code: 'ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE' });
  } else {
    const counted = await withRenderedContextTokenCounter(input, async counter => {
      held = counter;
      const first = await counter.count('a b'); assert.equal(first.tokens, 2);
      const second = await counter.count('abc'); assert.equal(second.tokens, 1);
      const repeated = await counter.count('a b'); assert.equal(repeated.tokens, 2);
      assert.deepEqual(counter.stats(), { counts: 3, cacheHits: 1, profileLoads: 1 });
      if (selected === 'publish-before-close') assert.throws(() => first.publish(), { code: 'ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE' });
      return second;
    });
    counted.publish();
    if (selected === 'retired') await assert.rejects(held.count('a'), { code: 'ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE' });
    if (selected === 'reuse') {
      await withRenderedContextTokenCounter(input, async counter => {
        assert.equal((await counter.count('abc')).tokens, 1);
        assert.deepEqual(counter.stats(), { counts: 1, cacheHits: 1, profileLoads: 0 });
      });
      await fs.appendFile(path.join(root, 'profile', 'tokenizer.json'), ' ');
      await assert.rejects(withRenderedContextTokenCounter(input, () => assert.fail('warm count cannot bypass current hash verification')),
        { code: 'ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE' });
    }
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log(`Original tokenizer invocation: ${selected}`);
