import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PreTrainedTokenizer } from '@huggingface/transformers';

const makeTokenizer = (Tokenizer, extraSuffix = false) => {
  const special = (id, token) => ({ id, content: token, special: true, single_word: false,
    lstrip: false, rstrip: false, normalized: false });
  const marker = token => ({ SpecialToken: { id: token, type_id: 0 } });
  return new Tokenizer({ version: '1.0', added_tokens: [special(0, '<s>'), special(1, '<pad>'),
    special(2, '</s>'), special(3, '<unk>'), special(6, '<end>')],
  normalizer: null, pre_tokenizer: { type: 'WhitespaceSplit' }, decoder: null,
  model: { type: 'WordLevel', vocab: { '<s>': 0, '<pad>': 1, '</s>': 2, '<unk>': 3, a: 4, b: 5, '<end>': 6 }, unk_token: '<unk>' },
  post_processor: { type: 'TemplateProcessing',
    single: [marker('<s>'), { Sequence: { id: 'A', type_id: 0 } }, marker('</s>'), ...(extraSuffix ? [marker('<end>')] : [])],
    pair: [marker('<s>'), { Sequence: { id: 'A', type_id: 0 } }, marker('</s>'),
      { Sequence: { id: 'B', type_id: 1 } }, marker('</s>')],
    special_tokens: Object.fromEntries([['<s>', 0], ['</s>', 2], ['<end>', 6]].map(([token, id]) =>
      [token, { id: token, ids: [id], tokens: [token] }])) }
  }, { model_max_length: 8, pad_token: '<pad>', bos_token: '<s>', eos_token: '</s>', unk_token: '<unk>' });
};

// Exercise both installed Node exports, rather than a copied tokenizer helper.
const require = createRequire(import.meta.url);
for (const Tokenizer of [PreTrainedTokenizer, require('@huggingface/transformers').PreTrainedTokenizer]) {
  const tokenizer = makeTokenizer(Tokenizer);
  const encode = (text, options = {}) => tokenizer(text, { return_tensor: false, ...options });
  for (const [text, expected] of [['a a', [0, 4, 4, 2]], ['a a a', [0, 4, 4, 4, 2]], ['a a a b', [0, 4, 4, 4, 2]]]) {
    const actual = encode(text, { truncation: true, max_length: 5, return_token_type_ids: true });
    assert.deepEqual(actual.input_ids, expected, 'truncate payload before the original template EOS');
    assert.deepEqual(actual.attention_mask, expected.map(() => 1));
    assert.deepEqual(actual.token_type_ids, expected.map(() => 0));
  }
  assert.deepEqual(encode('a a a b').input_ids, [0, 4, 4, 4, 5, 2], 'untruncated encoding is unchanged');
  assert.deepEqual(encode('a a a b', { add_special_tokens: false, truncation: true, max_length: 3 }).input_ids,
    [4, 4, 4], 'raw encoding does not invent EOS');
  const batch = encode(['a', 'a a a b'], { padding: true, truncation: true, max_length: 5 });
  assert.deepEqual(batch.input_ids, [[0, 4, 2, 1, 1], [0, 4, 4, 4, 2]]);
  assert.deepEqual(batch.attention_mask, [[1, 1, 1, 0, 0], [1, 1, 1, 1, 1]]);
  const tensor = tokenizer('a a a b', { truncation: true, max_length: 5 });
  assert.deepEqual([...tensor.input_ids.data], [0n, 4n, 4n, 4n, 2n]);
  assert.deepEqual(tensor.input_ids.dims, [1, 5]);
  for (const value of Object.values(tensor)) value.dispose?.();
  const multi = makeTokenizer(Tokenizer, true);
  assert.deepEqual(multi('a a a b', { truncation: true, max_length: 5, return_tensor: false }).input_ids,
    [0, 4, 4, 2, 6], 'preserve the entire configured suffix');
  assert.throws(() => multi('a a a b', { truncation: true, max_length: 2, return_tensor: false }),
    /special tokens/, 'an impossible template budget must reject before discarding its markers');
}
console.log('Both original Transformers Node exports preserve single-sequence template markers, payload budgets and aligned tensors.');
