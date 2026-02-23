const createEmptyArtifacts = () => ({
  cachedBundle: null,
  text: null,
  fileHash: null,
  fileHashAlgo: null,
  fileBuffer: null,
  fileEncoding: null,
  fileEncodingFallback: null,
  fileEncodingConfidence: null,
  documentExtraction: null
});

/**
 * Seed per-file artifacts from the optional in-memory text cache.
 *
 * @param {object} options
 * @param {object|null} options.fileTextCache
 * @param {string} options.relKey
 * @param {{size:number,mtimeMs:number}} options.fileStat
 * @returns {object}
 */
export function createPreCpuArtifactState({
  fileTextCache,
  relKey,
  fileStat
}) {
  const artifacts = createEmptyArtifacts();
  if (!fileTextCache?.get || !relKey) return artifacts;
  const cached = fileTextCache.get(relKey);
  if (typeof cached === 'string') {
    artifacts.text = cached;
    return artifacts;
  }
  if (!cached || typeof cached !== 'object') return artifacts;
  const stale = (
    (Number.isFinite(cached.size) && cached.size !== fileStat.size)
    || (Number.isFinite(cached.mtimeMs) && cached.mtimeMs !== fileStat.mtimeMs)
  );
  if (stale) return artifacts;
  if (typeof cached.text === 'string') artifacts.text = cached.text;
  if (Buffer.isBuffer(cached.buffer)) artifacts.fileBuffer = cached.buffer;
  if (cached.hash) {
    artifacts.fileHash = cached.hash;
    artifacts.fileHashAlgo = 'sha1';
  }
  if (typeof cached.encoding === 'string') artifacts.fileEncoding = cached.encoding;
  if (typeof cached.encodingFallback === 'boolean') {
    artifacts.fileEncodingFallback = cached.encodingFallback;
  }
  if (Number.isFinite(cached.encodingConfidence)) {
    artifacts.fileEncodingConfidence = cached.encodingConfidence;
  }
  return artifacts;
}

/**
 * Merge incremental bundle read results into active per-file artifacts.
 *
 * @param {object} options
 * @param {object} options.artifacts
 * @param {object|null} options.cachedResult
 */
export function applyCachedResultToArtifacts({
  artifacts,
  cachedResult
}) {
  artifacts.cachedBundle = cachedResult?.cachedBundle;
  artifacts.fileHash = cachedResult?.fileHash;
  if (artifacts.fileHash) artifacts.fileHashAlgo = 'sha1';
  artifacts.fileBuffer = cachedResult?.buffer;
  const cachedBundle = artifacts.cachedBundle;
  if (!cachedBundle || typeof cachedBundle !== 'object') return;
  if (!artifacts.fileEncoding && typeof cachedBundle.encoding === 'string') {
    artifacts.fileEncoding = cachedBundle.encoding;
  }
  if (typeof cachedBundle.encodingFallback === 'boolean') {
    artifacts.fileEncodingFallback = cachedBundle.encodingFallback;
  }
  if (Number.isFinite(cachedBundle.encodingConfidence)) {
    artifacts.fileEncodingConfidence = cachedBundle.encodingConfidence;
  }
}

/**
 * Build stable file info payload from active artifacts.
 *
 * @param {object} options
 * @param {{size:number}} options.fileStat
 * @param {object} options.artifacts
 * @returns {object}
 */
export function buildFileInfoFromArtifacts({
  fileStat,
  artifacts
}) {
  return {
    size: fileStat.size,
    hash: artifacts.fileHash,
    hashAlgo: artifacts.fileHashAlgo || null,
    encoding: artifacts.fileEncoding || null,
    encodingFallback: typeof artifacts.fileEncodingFallback === 'boolean'
      ? artifacts.fileEncodingFallback
      : null,
    encodingConfidence: Number.isFinite(artifacts.fileEncodingConfidence)
      ? artifacts.fileEncodingConfidence
      : null,
    ...(artifacts.documentExtraction ? { extraction: artifacts.documentExtraction } : {})
  };
}

/**
 * Persist active artifacts to the optional in-memory file cache.
 *
 * @param {object} options
 * @param {object|null} options.fileTextCache
 * @param {string} options.relKey
 * @param {{size:number,mtimeMs:number}} options.fileStat
 * @param {object} options.artifacts
 */
export function writeArtifactsToFileTextCache({
  fileTextCache,
  relKey,
  fileStat,
  artifacts
}) {
  if (!fileTextCache?.set || !relKey || (!artifacts.text && !artifacts.fileBuffer)) return;
  fileTextCache.set(relKey, {
    text: artifacts.text,
    buffer: artifacts.fileBuffer,
    hash: artifacts.fileHash,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    encoding: artifacts.fileEncoding || null,
    encodingFallback: typeof artifacts.fileEncodingFallback === 'boolean'
      ? artifacts.fileEncodingFallback
      : null,
    encodingConfidence: Number.isFinite(artifacts.fileEncodingConfidence)
      ? artifacts.fileEncodingConfidence
      : null
  });
}
