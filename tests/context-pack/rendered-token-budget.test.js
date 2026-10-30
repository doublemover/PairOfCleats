import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Tokenizer } from '@huggingface/tokenizers';
import { createContextTokenizerProfile } from '../helpers/context-tokenizer-profile.js';
import { countRenderedContextTokens } from '../../src/context-pack/token-counter.js';
import { applyRenderedTokenBudget } from '../../src/context-pack/rendered-token-budget.js';
import { resolveRenderedTokenBudget } from '../../src/context-pack/token-budget-policy.js';
import { contextTokenProjectionErrors } from '../../src/contracts/context-token-budget.js';
import { renderCompositeContextPack, renderCompositeContextPackJson } from '../../src/retrieval/output/composite-context-pack.js';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';

// UNVALIDATED: bounded real worker, local pinned JSON profiles and original
// contained files. Reference encodings also have hand-enumerated word controls.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const cases = ['ascii', 'unicode', 'long-identifiers', 'crlf', 'punctuation', 'profiles', 'special-tokens',
  'cache-content', 'cache-profile', 'cache-provenance', 'exact-limit', 'one-over', 'reserved-over', 'zero',
  'byte-limit', 'unavailable', 'integrity', 'invalid-request', 'cancelled', 'receipt'];
assert.ok(cases.includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'exact-tokens-'));
const rejected = (code, status) => error => error.code === code && (status === undefined || error.status === status);
try {
  const profile = await createContextTokenizerProfile(root, { special: selected === 'special-tokens', malformed: selected === 'unavailable' });
  const run = (text, policy = profile.policy, extra = {}) => countRenderedContextTokens({ text, policy, repoRoot: root, ...extra });
  if (selected === 'invalid-request') {
    for (const bad of [null, [], {}, { ...profile.input, extra: true }, { ...profile.input, maxTokens: -1 },
      { ...profile.input, reservedTokens: 1000001 }, { ...profile.input, profile: { ...profile.input.profile, engine: 'unknown' } },
      new Proxy(profile.input, { ownKeys() { throw new Error('must not inspect'); } })]) {
      assert.throws(() => resolveRenderedTokenBudget(bad), rejected('ERR_CONTEXT_PACK_INVALID_REQUEST', 400));
    }
    let invoked = false;
    const accessor = { ...profile.input }; Object.defineProperty(accessor, 'profile', { enumerable: true, get() { invoked = true; } });
    assert.throws(() => resolveRenderedTokenBudget(accessor), rejected('ERR_CONTEXT_PACK_INVALID_REQUEST')); assert.equal(invoked, false);
  } else if (selected === 'cancelled') {
    const controller = new AbortController(); controller.abort(new Error('caller cancelled'));
    await assert.rejects(run('a b', profile.policy, { signal: controller.signal }), rejected('ABORT_ERR'));
  } else if (selected === 'unavailable') {
    await assert.rejects(run('a b'), rejected('ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE', 422));
  } else if (selected === 'integrity') {
    await fs.appendFile(path.join(root, 'profile', 'tokenizer.json'), ' ');
    await assert.rejects(run('a b'), rejected('ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE', 422));
    const outside = resolveRenderedTokenBudget({ ...profile.input, profile: { ...profile.input.profile, directory: '..' } });
    await assert.rejects(run('a b', outside), rejected('ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE', 422));
  } else if (['ascii', 'unicode', 'long-identifiers', 'crlf', 'punctuation', 'special-tokens', 'profiles', 'cache-content', 'cache-profile'].includes(selected)) {
    const texts = { ascii: 'a b abc', unicode: '界😀 e\u0301 a', 'long-identifiers': 'x'.repeat(800) + ' a',
      crlf: 'a\r\nb\r\nabc\t', punctuation: 'a(b) { abc(); } "a\\nb"' };
    const text = texts[selected] ?? 'abc';
    const result = await run(text); result.publish();
    const expected = new Tokenizer(profile.tokenizer, profile.config).encode(text, { add_special_tokens: true }).ids.length;
    assert.equal(result.tokens, expected);
    if (selected === 'ascii') assert.equal(result.tokens, 3);
    if (selected === 'special-tokens') {
      assert.equal(result.tokens, 3);
      const noSpecial = resolveRenderedTokenBudget({ ...profile.input, profile: { ...profile.input.profile, addSpecialTokens: false } });
      assert.equal((await run(text, noSpecial)).tokens, 1);
    }
    if (selected === 'cache-content') {
      const words = await run('a b'); assert.equal(words.tokens, 2); words.publish();
      assert.equal((await run('abc')).tokens, 1, 'same-length text cannot reuse a different count');
    }
    if (selected === 'profiles' || selected === 'cache-profile') {
      const split = await createContextTokenizerProfile(root, { split: true });
      const next = await run('abc', split.policy); assert.equal(next.tokens, 3); next.publish();
      await assert.rejects(run('abc'), rejected('ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE'), 'warm counts still verify actual files');
    }
  } else {
    await fs.writeFile(path.join(root, 'source.js'), 'a b abc');
    const pack = assembleCompositeContextPack({ repoRoot: root, seed: { type: 'chunk', chunkUid: 'seed' },
      chunkMeta: [{ chunkUid: 'seed', file: 'source.js', start: 0, end: 7 }], includeGraph: false, indexSignature: 'fixed-generation',
      now: () => '2026-10-28T00:00:00.000Z' });
    if (selected === 'cache-provenance') {
      pack.primary.provenance = { excerptSource: 'fixture source', excerptHash: pack.primary.excerptHash,
        excerptBytes: Buffer.byteLength(pack.primary.excerpt) };
    }
    const options = { repoRoot: root };
    const initial = await applyRenderedTokenBudget(pack, profile.policy, options); initial.publish();
    assert.equal(initial.payload.renderedContext, renderCompositeContextPack(pack) + '\n');
    assert.equal(validateCompositeContextPack(initial.payload).ok, true);
    const tokens = initial.payload.tokenAccounting.renderedTokens;
    if (selected === 'exact-limit') {
      const policy = resolveRenderedTokenBudget({ ...profile.input, maxTokens: tokens + 2, reservedTokens: 2 });
      const counted = await applyRenderedTokenBudget(pack, policy, options); counted.publish();
      assert.equal(counted.payload.tokenAccounting.admittedTokens, tokens + 2);
    } else if (['one-over', 'reserved-over', 'zero'].includes(selected)) {
      const policy = resolveRenderedTokenBudget({ ...profile.input, maxTokens: selected === 'zero' ? 0 : tokens - 1,
        reservedTokens: selected === 'reserved-over' ? 1 : 0 });
      await assert.rejects(applyRenderedTokenBudget(pack, policy, options), rejected('ERR_CONTEXT_PACK_TOKEN_BUDGET', 413));
      assert.equal(pack.primary.excerpt, 'a b abc');
    } else if (selected === 'byte-limit') {
      const oversized = { ...pack, primary: { ...pack.primary, excerpt: 'a '.repeat(40000) } };
      await assert.rejects(applyRenderedTokenBudget(oversized, profile.policy, options), rejected('ERR_CONTEXT_PACK_RESPONSE_BUDGET', 413));
    } else if (selected === 'cache-provenance') {
      const changed = structuredClone(pack); changed.primary.provenance.excerptSource = 'different provenance with several words';
      const counted = await applyRenderedTokenBudget(changed, profile.policy, options);
      assert.notEqual(counted.payload.tokenAccounting.renderedSha256, initial.payload.tokenAccounting.renderedSha256);
      assert.notEqual(counted.payload.tokenAccounting.payloadSha256, initial.payload.tokenAccounting.payloadSha256);
    } else if (selected === 'receipt') {
      for (const change of [value => { value.primary.excerpt += '!'; }, value => { value.renderedContext += '!'; },
        value => { value.tokenAccounting.renderedTokens++; }, value => { value.tokenAccounting.revision = 'b'.repeat(40); }]) {
        const altered = structuredClone(initial.payload); change(altered);
        assert.ok(contextTokenProjectionErrors(altered).length); assert.equal(validateCompositeContextPack(altered).ok, false);
      }
      const projected = renderCompositeContextPackJson(initial.payload);
      assert.deepEqual(contextTokenProjectionErrors(projected), []);
    }
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log(`Exact rendered token budget: ${selected}`);
