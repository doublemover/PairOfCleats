/**
 * Allocate the per-file artifact container used across pre-CPU stages.
 *
 * @returns {{
 *   cachedBundle:object|null,
 *   text:string|null,
 *   fileHash:string|null,
 *   fileHashAlgo:string|null,
 *   fileBuffer:Buffer|null,
 *   fileEncoding:string|null,
 *   fileEncodingFallback:boolean|null,
 *   fileEncodingFallbackClass:string|null,
 *   fileEncodingFallbackRisk:string|null,
 *   fileEncodingConfidence:number|null,
 *   documentExtraction:object|null
 * }}
 */
const createEmptyArtifacts = () => ({
  cachedBundle: null,
  text: null,
  fileHash: null,
  fileHashAlgo: null,
  fileBuffer: null,
  fileEncoding: null,
  fileEncodingFallback: null,
  fileEncodingFallbackClass: null,
  fileEncodingFallbackRisk: null,
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
    // Unversioned legacy text has no freshness evidence. Re-read the source.
    return artifacts;
  }
  if (!cached || typeof cached !== 'object') return artifacts;
  const stale = !Number.isFinite(cached.size) || !Number.isFinite(cached.mtimeMs)
    || cached.size !== fileStat?.size || cached.mtimeMs !== fileStat?.mtimeMs;
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
  if (typeof cached.encodingFallbackClass === 'string') {
    artifacts.fileEncodingFallbackClass = cached.encodingFallbackClass;
  }
  if (typeof cached.encodingFallbackRisk === 'string') {
    artifacts.fileEncodingFallbackRisk = cached.encodingFallbackRisk;
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
  const sameSource = typeof artifacts.fileHash === 'string'
    && artifacts.fileHashAlgo === 'sha1'
    && artifacts.fileHash === cachedResult?.fileHash
    && Buffer.isBuffer(artifacts.fileBuffer) && Buffer.isBuffer(cachedResult?.buffer)
    && artifacts.fileBuffer.equals(cachedResult.buffer);
  if (!sameSource) {
    // Text and encoding describe one admitted byte snapshot. A newer hash or
    // missing byte admission cannot inherit decoded facts from a stat-only hit.
    artifacts.text = null;
    artifacts.fileEncoding = null;
    artifacts.fileEncodingFallback = null;
    artifacts.fileEncodingFallbackClass = null;
    artifacts.fileEncodingFallbackRisk = null;
    artifacts.fileEncodingConfidence = null;
    artifacts.documentExtraction = null;
  }
  artifacts.cachedBundle = cachedResult?.cachedBundle;
  artifacts.fileHash = cachedResult?.fileHash;
  artifacts.fileHashAlgo = artifacts.fileHash ? 'sha1' : null;
  artifacts.fileBuffer = cachedResult?.buffer;
  const cachedBundle = artifacts.cachedBundle;
  if (!cachedBundle || typeof cachedBundle !== 'object') return;
  if (!artifacts.fileEncoding && typeof cachedBundle.encoding === 'string') {
    artifacts.fileEncoding = cachedBundle.encoding;
  }
  if (typeof cachedBundle.encodingFallback === 'boolean') {
    artifacts.fileEncodingFallback = cachedBundle.encodingFallback;
  }
  if (typeof cachedBundle.encodingFallbackClass === 'string') {
    artifacts.fileEncodingFallbackClass = cachedBundle.encodingFallbackClass;
  }
  if (typeof cachedBundle.encodingFallbackRisk === 'string') {
    artifacts.fileEncodingFallbackRisk = cachedBundle.encodingFallbackRisk;
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
    encodingFallbackClass: typeof artifacts.fileEncodingFallbackClass === 'string'
      ? artifacts.fileEncodingFallbackClass
      : null,
    encodingFallbackRisk: typeof artifacts.fileEncodingFallbackRisk === 'string'
      ? artifacts.fileEncodingFallbackRisk
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
    encodingFallbackClass: typeof artifacts.fileEncodingFallbackClass === 'string'
      ? artifacts.fileEncodingFallbackClass
      : null,
    encodingFallbackRisk: typeof artifacts.fileEncodingFallbackRisk === 'string'
      ? artifacts.fileEncodingFallbackRisk
      : null,
    encodingConfidence: Number.isFinite(artifacts.fileEncodingConfidence)
      ? artifacts.fileEncodingConfidence
      : null
  });
}
