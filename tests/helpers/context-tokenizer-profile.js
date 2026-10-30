import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveRenderedTokenBudget } from '../../src/context-pack/token-budget-policy.js';

export const createContextTokenizerProfile = async (repoRoot, { split = false, special = false, malformed = false } = {}) => {
  const directory = path.join(repoRoot, 'profile'); await fs.mkdir(directory, { recursive: true });
  const tokenizer = {
    version: '1.0', truncation: null, padding: null, added_tokens: [], normalizer: null,
    pre_tokenizer: { type: 'WhitespaceSplit' }, decoder: { type: 'WordPiece', prefix: '##', cleanup: false },
    post_processor: special ? { type: 'BertProcessing', sep: ['[SEP]', 7], cls: ['[CLS]', 6] } : null,
    model: { type: 'WordPiece', unk_token: '[UNK]', continuing_subword_prefix: '##', max_input_chars_per_word: 1024,
      vocab: { '[UNK]': 0, a: 1, b: 2, ...(split ? { '##b': 3, '##c': 4 } : { abc: 3 }), '[CLS]': 6, '[SEP]': 7 } }
  };
  const config = {};
  const tokenizerBytes = malformed ? 'not-json' : JSON.stringify(tokenizer), configBytes = JSON.stringify(config);
  await fs.writeFile(path.join(directory, 'tokenizer.json'), tokenizerBytes);
  await fs.writeFile(path.join(directory, 'tokenizer_config.json'), configBytes);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const input = { schemaVersion: 1, maxTokens: 1000000, reservedTokens: 0,
    profile: { id: split ? 'fixture-split' : 'fixture-words', revision: 'a'.repeat(40), directory: 'profile',
      tokenizerSha256: hash(tokenizerBytes), configSha256: hash(configBytes), addSpecialTokens: true } };
  return { input, policy: resolveRenderedTokenBudget(input), tokenizer, config };
};
