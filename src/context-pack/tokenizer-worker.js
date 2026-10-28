import { Tokenizer } from '@huggingface/tokenizers';
import { observeWorkerHeap } from '../shared/workers/heap-contract.js';

export default function countRenderedContext({ tokenizerBytes, configBytes, text, addSpecialTokens }) {
  const heap = observeWorkerHeap();
  if (!heap.resourceLimitAcknowledged) throw new Error('Tokenizer worker heap bound was not acknowledged.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const tokenizer = JSON.parse(decoder.decode(tokenizerBytes)), config = JSON.parse(decoder.decode(configBytes));
  if (!['WordPiece', 'BPE', 'Unigram'].includes(tokenizer.model?.type)) throw new Error('Unsupported exact tokenizer model type.');
  const pending = [tokenizer, config];
  let visited = 0;
  while (pending.length) {
    if (++visited > 262144) throw new Error('Tokenizer profile exceeds its structural work allowance.');
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    // Validate actual pattern-bearing pipeline components. A vocabulary entry
    // named "pattern" is ordinary tokenizer data, not a pipeline option.
    if (['Replace', 'Split'].includes(value.type)) {
      const pattern = value.pattern;
      if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern) || Object.keys(pattern).length !== 1
        || !['Regex', 'String'].some(kind => typeof pattern[kind] === 'string')) throw new Error('Unsupported exact tokenizer pattern.');
    }
    for (const [key, child] of Object.entries(value)) {
      if (pending.length >= 65536) throw new Error('Tokenizer profile exceeds its pending-field allowance.');
      pending.push(child);
    }
  }
  // This envelope encodes the complete string, without padding, sampling,
  // truncation or an implicit model/chat-template wrapper.
  if (tokenizer.truncation != null || tokenizer.padding != null || config.truncation === true || config.padding === true
    || tokenizer.model?.dropout > 0 || config.enable_sampling === true) {
    throw new Error('Tokenizer profile requests unsupported truncation, padding or sampling.');
  }
  const encoding = new Tokenizer(tokenizer, config).encode(text, { add_special_tokens: addSpecialTokens });
  const ids = encoding.ids;
  if (!Array.isArray(ids) || ids.length > 1048576 || ids.some(id => !Number.isSafeInteger(id) || id < 0)) {
    throw new Error('Tokenizer returned an invalid or oversized exact encoding.');
  }
  return { tokens: ids.length, heapAcknowledged: true };
}
