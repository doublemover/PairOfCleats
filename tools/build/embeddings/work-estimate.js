/** Remaining work stays factored by source file; no text copies or graph expansion. */
export const createEmbeddingWorkEstimate = ({ entries, charsPerToken = 4, now = Date.now }) => {
  const remaining = new Map();
  let remainingTokens = 0;
  const estimateChars = (chars) => Math.max(1, Math.ceil(Math.max(0, Number(chars) || 0) / charsPerToken));
  for (const [id, items] of entries) {
    let tokens = 0;
    for (const { chunk } of items) {
      tokens += estimateChars(chunk.text?.length ?? (chunk.end - chunk.start));
      if (chunk.docmeta?.doc) tokens += estimateChars(chunk.docmeta.doc.length);
    }
    remaining.set(id, tokens);
    remainingTokens += tokens;
  }
  // A bounded recent window adapts to changing source lengths/cache reuse, rather
  // than carrying startup and earlier files in a lifetime average.
  const samples = [];
  const startedAt = now();
  const replace = (id, tokens) => {
    if (!remaining.has(id)) return;
    const next = Math.max(0, Number(tokens) || 0);
    remainingTokens += next - remaining.get(id);
    remaining.set(id, next);
  };
  return {
    prepare: (id, tokens) => replace(id, tokens),
    adjust: (id, tokens) => replace(id, (remaining.get(id) || 0) + tokens),
    batch: ({ groupTokens = [], batchTokens, durationMs }) => {
      for (const [id, tokens] of groupTokens) replace(id, Math.max(0, (remaining.get(id) || 0) - tokens));
      if (batchTokens > 0 && durationMs >= 0) {
        samples.push({ tokens: batchTokens, ms: Math.max(1, durationMs), at: now() });
        if (samples.length > 64) samples.shift();
      }
    },
    complete: (id) => { replace(id, 0); remaining.delete(id); },
    snapshot: () => {
      const recent = samples.filter((sample) => sample.at >= now() - 120000);
      // Retain the last batch during a long-running call, without manufacturing a
      // zero ETA when no recent batch has completed.
      const usable = recent.length ? recent : samples.slice(-1);
      const tokens = usable.reduce((sum, sample) => sum + sample.tokens, 0);
      // Wall-time span includes producer gaps and counts overlapping provider
      // calls once, rather than treating summed call time as elapsed time.
      const ms = usable.length ? Math.max(1, usable.at(-1).at
        - Math.min(...usable.map((sample) => sample.at - sample.ms))) : 0;
      return {
        remainingTokens: Math.max(0, remainingTokens),
        remainingGroups: remaining.size,
        samples: usable.length,
        etaSeconds: remainingTokens <= 0 ? 0 : tokens > 0 ? remainingTokens * ms / tokens / 1000 : null,
        observedMs: Math.max(0, now() - startedAt)
      };
    }
  };
};
