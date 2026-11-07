const invalid = message => Object.assign(new Error(message), { code: 'ERR_LOCAL_RERANKER_PROFILE' });
const runtimeBindings = new WeakMap();
const passive = (original, name) => {
  if (!original || (typeof original !== 'object' && typeof original !== 'function')) throw invalid('Cross-encoder input requires original passive data.');
  const descriptor = Object.getOwnPropertyDescriptor(original, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid('Cross-encoder input requires original own data properties.');
  return descriptor.value;
};

export const captureCrossEncoderTokens = (original, maximum, binary = false) => {
  if (!Array.isArray(original)) throw invalid('Cross-encoder token row is malformed.');
  const width = passive(original, 'length');
  if (!Number.isSafeInteger(width) || width < 0 || width > maximum) throw invalid('Cross-encoder token allowance exceeded; truncation is disabled.');
  const values = [];
  for (let index = 0; index < width; index++) {
    const value = passive(original, index);
    if (!Number.isSafeInteger(value) || value < 0 || binary && value > 1) throw invalid('Cross-encoder input tensor is malformed.');
    values.push(value);
  }
  return Object.freeze(values);
};

/** Capture callable runtime boundaries before source awaits. Session input
 * metadata cannot become a replacement iterator or change a later member's IO. */
export const captureCrossEncoderRuntime = (tokenizer, session) => {
  if (typeof tokenizer !== 'function') throw invalid('Cross-encoder requires its original callable tokenizer.');
  const encode = tokenizer.encode, run = session.run, names = session.inputNames;
  if (typeof encode !== 'function' || typeof run !== 'function' || !Array.isArray(names)) throw invalid('Cross-encoder requires original encode/run/input capabilities.');
  const count = passive(names, 'length'), inputNames = [], seen = new Set();
  if (!Number.isSafeInteger(count) || count < 2 || count > 3) throw invalid('Cross-encoder graph input capability is incompatible.');
  for (let index = 0; index < count; index++) {
    const name = passive(names, index);
    if (!['input_ids', 'attention_mask', 'token_type_ids'].includes(name) || seen.has(name)) throw invalid('Cross-encoder graph input capability is incompatible.');
    seen.add(name); inputNames.push(name);
  }
  if (!seen.has('input_ids') || !seen.has('attention_mask')) throw invalid('Cross-encoder graph input capability is incompatible.');
  const runtime = Object.freeze({ inputNames: Object.freeze(inputNames),
    encode: (query, options) => Reflect.apply(encode, tokenizer, [query, options]),
    tokenize: (query, options) => Reflect.apply(tokenizer, undefined, [query, options]),
    run: (feeds, outputs) => Reflect.apply(run, session, [feeds, outputs]) });
  runtimeBindings.set(runtime, { tokenizer, session });
  return runtime;
};

export const assertCapturedCrossEncoderRuntime = (runtime, tokenizer, session) => {
  const original = runtimeBindings.get(runtime);
  if (!original || original.tokenizer !== tokenizer || original.session !== session) throw invalid('Cross-encoder runtime requires its exact original captured producer and resource objects.');
  return runtime;
};

export const captureCrossEncoderPair = (original, inputNames, maximum) => {
  const rows = new Map();
  const ids = captureCrossEncoderTokens(passive(original, 'input_ids'), maximum);
  if (!ids.length) throw invalid('Cross-encoder pair token allowance exceeded; truncation is disabled.');
  rows.set('input_ids', ids);
  for (const name of inputNames) {
    if (name === 'input_ids') continue;
    const row = captureCrossEncoderTokens(passive(original, name), maximum, true);
    if (row.length !== ids.length) throw invalid('Cross-encoder input tensor is malformed.');
    rows.set(name, row);
  }
  return rows;
};

/** The authoritative returned source remains data, not a getter callback that
 * can replace text between generation/span/hash/character-budget checks. */
export const captureCrossEncoderSource = original => Object.freeze(Object.fromEntries(
  ['key', 'generation', 'complete', 'offsetUnit', 'start', 'end', 'text', 'contentDigest'].map(name => [name, passive(original, name)])
));
