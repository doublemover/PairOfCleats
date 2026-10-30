/** Codec v2 binds the effective scalar encoder to inline and deferred bytes. */
export const EMBEDDING_QUANTIZATION_VERSION = 2;
const resolvedSpecs = new WeakSet();
const invalid = message => Object.assign(new TypeError(`[embeddings] ${message}`), { code: 'ERR_EMBEDDING_QUANTIZATION' });

/** Preserve the historical level floor/clamp; reject invalid explicit ranges. */
export const resolveEmbeddingQuantizationSpec = (input = {}) => {
  if (input && typeof input === 'object' && resolvedSpecs.has(input)) return input;
  const minVal = input?.minVal ?? input?.min_val ?? -1;
  const maxVal = input?.maxVal ?? input?.max_val ?? 1;
  if (typeof minVal !== 'number' || typeof maxVal !== 'number'
    || !Number.isFinite(minVal) || !Number.isFinite(maxVal) || maxVal <= minVal) {
    throw invalid('Quantization requires finite minVal < maxVal.');
  }
  const requestedLevels = Number(input?.levels ?? 256);
  if (!Number.isFinite(requestedLevels)) throw invalid('Quantization levels must be finite.');
  const levels = Math.min(256, Math.max(2, Math.floor(requestedLevels)));
  const scale = (maxVal - minVal) / (levels - 1);
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(1 / scale)) throw invalid('Quantization scale is not representable.');
  const zeroPoint = Math.min(levels - 1, Math.max(0, Math.round(-minVal / scale)));
  const spec = Object.freeze({ version: EMBEDDING_QUANTIZATION_VERSION, minVal, maxVal, levels,
    scale, zeroPoint, paddingValue: zeroPoint, absence: 'validity-mask' });
  resolvedSpecs.add(spec);
  return spec;
};

/** Validate before any coercion can truncate, wrap or manufacture byte rows. */
export const assertQuantizedEmbeddingRow = (row, { spec = resolveEmbeddingQuantizationSpec(), dims = null, allowEmpty = true } = {}) => {
  if (!(Array.isArray(row) || row instanceof Uint8Array)) throw invalid('Quantized row must be an array or Uint8Array.');
  if (!row.length) {
    if (allowEmpty) return row;
    throw invalid('Present quantized rows must be nonempty.');
  }
  if (dims != null && row.length !== dims) throw invalid(`Quantized row width ${row.length} differs from ${dims}.`);
  for (let index = 0; index < row.length; index++) {
    const value = row[index];
    if (!Number.isInteger(value) || value < 0 || value >= spec.levels) throw invalid(`Invalid quantized value at dimension ${index} (levels=${spec.levels}).`);
  }
  return row;
};

export const resolveDenseQuantizationSpec = (meta = {}, expected = null) => {
  meta ||= {};
  const spec = resolveEmbeddingQuantizationSpec(meta);
  const identity = meta.embeddingIdentity?.quantization;
  for (const version of [meta.quantizationVersion, identity?.version]) {
    if (version != null && version !== 1 && version !== EMBEDDING_QUANTIZATION_VERSION) throw invalid('Unsupported dense quantization codec version.');
  }
  if (meta.quantizationVersion >= EMBEDDING_QUANTIZATION_VERSION || identity?.version >= EMBEDDING_QUANTIZATION_VERSION) {
    if (meta.scale != null && meta.scale !== spec.scale) throw invalid('Dense metadata scale disagrees with its codec.');
    if (identity) {
      const expected = resolveEmbeddingQuantizationSpec(identity);
      if (['minVal', 'maxVal', 'levels'].some(key => expected[key] !== spec[key])) throw invalid('Dense metadata disagrees with its embedding identity codec.');
    }
  }
  if (expected) {
    const requested = resolveEmbeddingQuantizationSpec(expected);
    if (['minVal', 'maxVal', 'levels'].some(key => requested[key] !== spec[key])) throw invalid('Dense source codec disagrees with the selected backend codec.');
  }
  return spec;
};
