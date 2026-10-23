const FLOAT_TYPES = new Set(['float32', 'float64']);

/** Diagnostics contain only layout evidence, never submitted text. */
export const invalidEmbeddingOutput = (message, details = {}) => Object.assign(
  new Error(`Invalid embedding provider output: ${message}`),
  { code: 'ERR_EMBEDDING_OUTPUT', ...details }
);

const numericStorage = data => Array.isArray(data)
  || data instanceof Float32Array || data instanceof Float64Array;

/** Admit tensor metadata before any slicing, pooling or numeric conversion.
 * A tensor's own view length is authoritative, not its backing buffer length.
 */
export const admitEmbeddingTensor = (tensor, count, {
  provider = null, batchId = null, ranks = [1, 2], dimensions = null
} = {}) => {
  const shape = tensor?.dims, data = tensor?.data, dtype = tensor?.type ?? null;
  const details = { provider, batchId, expectedRows: count, observedDims: Array.isArray(shape) ? [...shape] : null,
    observedDtype: dtype, observedElements: data?.length ?? null, expectedDimensions: dimensions };
  const fail = message => { throw invalidEmbeddingOutput(message, details); };
  if (!Number.isSafeInteger(count) || count < 0) fail('invalid requested batch size.');
  if (!Array.isArray(shape) || !ranks.includes(shape.length)
    || shape.some(value => !Number.isSafeInteger(value) || value <= 0)) fail('unsupported or invalid tensor shape.');
  const rows = shape.length === 1 ? 1 : shape[0];
  details.observedRows = rows;
  if (rows !== count) fail('tensor batch size does not match the request.');
  let elements = 1;
  for (const dimension of shape) {
    elements *= dimension;
    if (!Number.isSafeInteger(elements)) fail('tensor shape exceeds safe element counts.');
  }
  if (dtype !== null && !FLOAT_TYPES.has(dtype)) fail('unsupported tensor dtype.');
  if (!numericStorage(data) || data.length !== elements) fail('tensor data length disagrees with its shape.');
  if (dtype === 'float32' && !(data instanceof Float32Array)
    || dtype === 'float64' && !(data instanceof Float64Array)) fail('tensor storage disagrees with its dtype.');
  const width = shape.at(-1);
  if (dimensions !== null && width !== dimensions) fail('tensor width disagrees with the model contract.');
  return { shape, data, rows, width, details };
};

/** Validate source values before coercion, and Float32 representability after it. */
export const copyEmbeddingValues = (data, start, width, details = {}, target = null, requireNonzero = false) => {
  const vector = target || new Float32Array(width);
  let norm = 0;
  for (let column = 0; column < width; column++) {
    const value = data[start + column];
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
      throw invalidEmbeddingOutput('embedding component is not a finite Float32 number.', { ...details, column });
    }
    vector[column] = value;
    if (requireNonzero) norm += vector[column] * vector[column];
  }
  if (requireNonzero && (!(norm > 0) || !Number.isFinite(norm))) {
    throw invalidEmbeddingOutput('embedding has a zero or invalid norm.', details);
  }
  return vector;
};

/** Shared pooled-output boundary for batch, single and already-prepared paths.
 * Token outputs require an explicit model decoder; rank alone is not semantics.
 */
export const admitEmbeddingBatchOutput = (output, count, options = {}) => {
  const details = { provider: options.provider ?? null, batchId: options.batchId ?? null,
    expectedRows: count, observedRows: Array.isArray(output) ? output.length : null };
  if (!Number.isSafeInteger(count) || count < 0) throw invalidEmbeddingOutput('invalid requested batch size.', details);
  if (Array.isArray(output)) {
    if (output.length !== count) throw invalidEmbeddingOutput('array batch size does not match the request.', details);
    let width = options.dimensions ?? null;
    return output.map((entry, row) => {
      const data = entry?.data ?? entry;
      const rowDetails = { ...details, row };
      if (entry && typeof entry === 'object' && 'data' in entry) {
        admitEmbeddingTensor({ dims: entry.dims ?? [data?.length], data, type: entry.type }, 1,
          { ...options, dimensions: width });
      }
      if (!numericStorage(data) || !data.length) throw invalidEmbeddingOutput('empty or nonnumeric vector storage.', rowDetails);
      if (width === null) width = data.length;
      if (data.length !== width) throw invalidEmbeddingOutput('array embedding dimensions disagree.', { ...rowDetails,
        expectedDimensions: width, observedDimensions: data.length });
      // Ordinary Float32 vectors can retain their owned buffer. The adapter
      // copies only when that buffer belongs to a captured native resource.
      return copyEmbeddingValues(data, 0, width, rowDetails, data instanceof Float32Array ? data : null, options.requireNonzero);
    });
  }
  if (count === 0 && output == null) return [];
  const { data, rows, width, details: tensorDetails } = admitEmbeddingTensor(output, count, options);
  return Array.from({ length: rows }, (_, row) => copyEmbeddingValues(data, row * width, width,
    { ...tensorDetails, row }, null, options.requireNonzero));
};
