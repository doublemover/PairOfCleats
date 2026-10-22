const PREFERRED = ['sentence_embedding', 'embeddings', 'pooler_output', 'last_hidden_state', 'output_0'];
const FLOAT_TYPES = new Set(['float32', 'float64']);
const plans = new WeakMap();
const invalid = message => Object.assign(new Error(message), { code: 'ERR_ONNX_EMBEDDING_OUTPUT' });

/** Qualify the existing output preference against this exact loaded session's
 * metadata. Unknown/unsupported metadata preserves the generic all-output run.
 * The pinned ORT common API accepts a nonempty output-name array as fetches.
 */
export const selectOnnxEmbeddingOutput = session => {
  if (plans.has(session)) return plans.get(session);
  let plan = null;
  let names, metadata;
  try { names = session.outputNames; metadata = session.outputMetadata; }
  catch { plans.set(session, null); return null; }
  if (Array.isArray(names) && names.length && new Set(names).size === names.length && Array.isArray(metadata)) {
    const name = PREFERRED.find(value => names.includes(value));
    const selected = metadata.filter(value => value?.name === name);
    const value = selected[0];
    if (name && selected.length === 1 && value.isTensor === true && FLOAT_TYPES.has(value.type)
      && Array.isArray(value.shape) && [2, 3].includes(value.shape.length)
      && value.shape.every(dimension => typeof dimension === 'string' && dimension.length > 0
        || Number.isSafeInteger(dimension) && dimension > 0)) {
      plan = Object.freeze({ name, type: value.type, rank: value.shape.length,
        shape: Object.freeze([...value.shape]), method: 'loaded-session-output-metadata' });
    }
  }
  plans.set(session, plan);
  return plan;
};

export const findOnnxEmbeddingOutput = outputs => {
  if (!outputs) return null;
  for (const name of PREFERRED) if (outputs[name]) return outputs[name];
  const fallback = Object.keys(outputs)[0];
  return fallback ? outputs[fallback] : null;
};

const logicalBytes = tensor => {
  const widths = { float32: 4, float64: 8, float16: 2, bfloat16: 2, int64: 8,
    int32: 4, int16: 2, int8: 1, uint8: 1, bool: 1 };
  if (!Array.isArray(tensor?.dims) || !widths[tensor.type]) return 0;
  let size = widths[tensor.type];
  for (const dimension of tensor.dims) {
    if (!Number.isSafeInteger(dimension) || dimension < 0 || !Number.isSafeInteger(size * dimension)) return 0;
    size *= dimension;
  }
  return size;
};

/** No retry on a selected-fetch failure: native errors retain their identity.
 * Logical tensor bytes are work counts, not measured PCIe/device transfer bytes.
 */
export const runOnnxEmbeddingSession = async ({ session, feeds, measurements }) => {
  const plan = selectOnnxEmbeddingOutput(session);
  const outputs = plan ? await session.run(feeds, [plan.name]) : await session.run(feeds);
  if (plan && (!outputs || !Object.hasOwn(outputs, plan.name))) throw invalid('ONNX selected output was not returned.');
  if (measurements) {
    const count = Object.keys(outputs || {}).length;
    measurements.outputsFetched = (measurements.outputsFetched || 0) + count;
    measurements.outputTensorBytes = (measurements.outputTensorBytes || 0)
      + Object.values(outputs || {}).reduce((sum, tensor) => sum + logicalBytes(tensor), 0);
    measurements.selectiveOutputRuns = (measurements.selectiveOutputRuns || 0) + (plan ? 1 : 0);
    measurements.genericOutputRuns = (measurements.genericOutputRuns || 0) + (plan ? 0 : 1);
    measurements.outputSelection = plan;
  }
  return outputs;
};

/** Preserve the established Float32 assignment after every rank-3 addition and
 * division, including nonzero-mask rather than mask-weighted averaging. */
export const decodeOnnxEmbeddingOutput = ({ outputs, attentionMask, normalizeVector, count, measurements }) => {
  const tensor = findOnnxEmbeddingOutput(outputs);
  if (!tensor) return Array.from({ length: count }, () => []);
  const shape = tensor.dims;
  if (!Array.isArray(shape) || ![2, 3].includes(shape.length)
    || shape.some(value => !Number.isSafeInteger(value) || value <= 0)
    || shape[0] !== count || tensor.type && !FLOAT_TYPES.has(tensor.type)) throw invalid('ONNX embedding output has an invalid shape or dtype.');
  const elements = shape.reduce((product, value) => product * value, 1), data = tensor.data;
  if (!Number.isSafeInteger(elements) || !data || data.length !== elements) throw invalid('ONNX embedding output length disagrees with its shape.');
  const started = performance.now(), cpuStarted = process.cpuUsage();
  const output = new Array(count), width = shape.at(-1);
  let valuesRead = 0;
  for (let batch = 0; batch < count; batch++) {
    const vector = new Float32Array(width);
    if (shape.length === 2) {
      for (let coordinate = 0; coordinate < width; coordinate++) {
        const value = data[batch * width + coordinate];
        if (!Number.isFinite(value)) throw invalid('ONNX sentence embedding contains a nonfinite value.');
        vector[coordinate] = value; valuesRead++;
      }
    } else {
      const sequence = shape[1]; let selectedTokens = 0;
      for (let token = 0; token < sequence; token++) {
        if (attentionMask && !Number(attentionMask[batch]?.[token] ?? 0)) continue;
        selectedTokens++;
        for (let coordinate = 0; coordinate < width; coordinate++) {
          const value = data[(batch * sequence + token) * width + coordinate];
          if (!Number.isFinite(value)) throw invalid('ONNX unmasked token embedding contains a nonfinite value.');
          vector[coordinate] += value; valuesRead++;
        }
      }
      if (selectedTokens) for (let coordinate = 0; coordinate < width; coordinate++) vector[coordinate] /= selectedTokens;
    }
    output[batch] = normalizeVector(vector);
  }
  if (measurements) {
    const cpu = process.cpuUsage(cpuStarted);
    measurements.outputConversionWallMs = (measurements.outputConversionWallMs || 0) + performance.now() - started;
    measurements.outputConversionProcessCpuMicros = (measurements.outputConversionProcessCpuMicros || 0) + cpu.user + cpu.system;
    measurements.outputValuesRead = (measurements.outputValuesRead || 0) + valuesRead;
    measurements.hostPooledRows = (measurements.hostPooledRows || 0) + (shape.length === 3 ? count : 0);
    measurements.sentenceOutputRows = (measurements.sentenceOutputRows || 0) + (shape.length === 2 ? count : 0);
  }
  return output;
};
