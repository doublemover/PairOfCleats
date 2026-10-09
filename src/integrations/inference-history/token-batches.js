import { historyError } from './common.js';

/** Stable length packing in a bounded window; each window drains before another is admitted. */
export function planHistoryTokenBatches(rows, tokenLengths, controls) {
  if (!Array.isArray(tokenLengths) || tokenLengths.length !== rows.length
    || tokenLengths.some(value => !Number.isSafeInteger(value) || value < 1 || value > 8192)) {
    throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid prepared archive token lengths.');
  }
  const ordered = rows.map((row, index) => ({ index, tokens: tokenLengths[index], chars: row.text.length }))
    .sort((a, b) => a.tokens - b.tokens || a.index - b.index);
  const batches = [];
  let current = [], chars = 0, longest = 0;
  for (const row of ordered) {
    const nextLength = Math.max(longest, row.tokens), nextSize = current.length + 1;
    if (row.chars > controls.maxBatchChars || row.tokens > controls.maxPaddedTokens
      || row.tokens * row.tokens > controls.maxAttentionTokens) {
      throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'One archive input exceeds token batch budgets.');
    }
    if (current.length && (nextSize > controls.batchSize || chars + row.chars > controls.maxBatchChars
      || nextSize * nextLength > controls.maxPaddedTokens
      || nextSize * nextLength * nextLength > controls.maxAttentionTokens)) {
      batches.push(current.map(item => item.index)); current = []; chars = 0; longest = 0;
    }
    current.push(row); chars += row.chars; longest = Math.max(longest, row.tokens);
  }
  if (current.length) batches.push(current.map(item => item.index));
  return batches;
}
