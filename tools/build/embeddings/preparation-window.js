/** Internal source windows. Keep the existing queue as the sole byte/item
 * admission owner; its reservation spans preparation, dispatch and release. */
export function* embeddingPreparationWindows(texts, maxBytes, maxItems = 256) {
  const limit = Math.min(maxBytes, 4 * 1024 * 1024);
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(maxItems) || maxItems < 1) throw new RangeError('Invalid embedding preparation admission.');
  const size = text => String(text).length * 2 + 16;
  for (const text of texts) if (size(text) > limit) throw new RangeError('Embedding text exceeds preparation byte admission.');
  let start = 0, bytes = 0;
  for (let index = 0; index < texts.length; index++) {
    const next = size(texts[index]);
    if (index > start && (index - start === maxItems || bytes + next > limit)) {
      yield { start, end: index, bytes }; start = index; bytes = 0;
    }
    bytes += next;
  }
  if (start < texts.length) yield { start, end: texts.length, bytes };
}

export const runAdmittedEmbeddingPreparation = async (admission, bytes, run) => {
  let resolve, reject;
  const result = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  // Queue admission may yield before this caller returns the result promise.
  result.catch(() => {});
  try {
    await admission.enqueue(async () => {
      try { resolve(await run()); }
      catch (error) { reject(error); throw error; }
    }, { bytes });
  } catch (error) { reject(error); }
  return result;
};
