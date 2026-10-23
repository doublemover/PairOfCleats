/** A request binds its original callback, receiver and diagnostic/score identity
 * before asynchronous adapter work. Later field replacement is not authority. */
export const captureRerankerAdapter = adapter => {
  const id = adapter.id, rerank = adapter.rerank;
  if (typeof id !== 'string' || !id || typeof rerank !== 'function') throw new TypeError('Reranker requires id and rerank');
  const identityKey = adapter.identityKey ?? null, formattingIdentity = adapter.formattingIdentity ?? null;
  if (identityKey !== null && typeof identityKey !== 'string'
    || formattingIdentity !== null && typeof formattingIdentity !== 'string') throw new TypeError('Reranker identity requires immutable string evidence.');
  const range = adapter.scoreRange, minimum = range?.min ?? -1000000, maximum = range?.max ?? 1000000;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) throw new TypeError('Invalid reranker score range.');
  return Object.freeze({ id, identityKey, formattingIdentity, minimum, maximum,
    rerank: request => Reflect.apply(rerank, adapter, [request]) });
};

const passive = (original, name, message) => {
  const descriptor = Object.getOwnPropertyDescriptor(original, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(message);
  return descriptor.value;
};

/** Scores refer only to dense original members. Never execute an adapter's
 * array iterator, entry accessors or inherited score/index as ranking evidence. */
export const captureRerankerScores = (original, count, { minimum, maximum }) => {
  const membership = 'Reranker must score each evidence member', invalid = 'Invalid reranker evidence scores';
  if (!Array.isArray(original) || passive(original, 'length', membership) !== count) throw new TypeError(membership);
  const scores = new Map();
  for (let rank = 0; rank < count; rank++) {
    const row = passive(original, rank, invalid);
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError(invalid);
    const names = Reflect.ownKeys(row);
    if (names.length !== 2 || !names.includes('index') || !names.includes('score')) throw new TypeError(invalid);
    const index = passive(row, 'index', invalid), score = passive(row, 'score', invalid);
    if (!Number.isInteger(index) || index < 0 || index >= count || scores.has(index)
      || !Number.isFinite(score) || score < minimum || score > maximum) throw new TypeError(invalid);
    scores.set(index, score);
  }
  return scores;
};
