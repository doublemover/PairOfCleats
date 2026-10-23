/** Provider configuration and artifact metadata are plain data. Capture them
 * before an asynchronous acquisition can observe a caller's later mutations.
 */
export const snapshotEmbeddingMetadata = value => {
  if (value == null) return value;
  const snapshot = structuredClone(value), pending = [snapshot], seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    if (seen.size >= 512 || !Array.isArray(current)
      && ![Object.prototype, null].includes(Object.getPrototypeOf(current))) {
      throw Object.assign(new Error('Embedding selection metadata must be bounded plain data.'), { code: 'ERR_EMBEDDING_SELECTION' });
    }
    seen.add(current);
    for (const child of Object.values(current)) pending.push(child);
    Object.freeze(current);
  }
  return snapshot;
};

export const snapshotEmbeddingArtifactSelection = (options = {}) => ({
  provider: options.provider, modelId: options.modelId, modelsDir: options.modelsDir, rootDir: options.rootDir,
  onnx: snapshotEmbeddingMetadata(options.onnx), modelProfile: snapshotEmbeddingMetadata(options.modelProfile), stub: options.stub === true
});

/** Snapshot request containers at the outermost accepted call. Signals and
 * prepared-item capabilities retain their original identity; no native owner
 * or opaque prepared item is cloned or transferred by this operation. */
export const snapshotEmbeddingRequestArguments = args => args.map(value => Array.isArray(value) ? value.slice()
  : value && typeof value === 'object' ? { ...value, ...(Array.isArray(value.texts) ? { texts: value.texts.slice() } : {}) } : value);
