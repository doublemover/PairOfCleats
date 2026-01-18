export const DEFAULT_EMBEDDING_POOLING = 'mean';
export const DEFAULT_EMBEDDING_NORMALIZE = true;
export const DEFAULT_EMBEDDING_TRUNCATION = true;

const isVectorLike = (value) => (
  Array.isArray(value)
  || (ArrayBuffer.isView(value) && !(value instanceof DataView))
);

export const mergeEmbeddingVectors = ({ codeVector, docVector }) => {
  const code = isVectorLike(codeVector) ? codeVector : [];
  const doc = isVectorLike(docVector) ? docVector : [];
  const length = code.length || doc.length || 0;
  const merged = length ? new Float32Array(length) : new Float32Array(0);
  if (code.length) {
    for (let i = 0; i < merged.length; i += 1) {
      merged[i] = (code[i] + (doc[i] ?? 0)) / 2;
    }
  } else if (doc.length) {
    for (let i = 0; i < merged.length; i += 1) {
      merged[i] = doc[i] ?? 0;
    }
  }
  return merged;
};

export const normalizeEmbeddingVectorInPlace = (vec) => {
  let norm = 0;
  for (let i = 0; i < vec.length; i += 1) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm === 0) return vec;
  for (let i = 0; i < vec.length; i += 1) {
    vec[i] = vec[i] / norm;
  }
  return vec;
};

export const normalizeEmbeddingVector = (vec) => {
  const length = vec && typeof vec.length === 'number' ? vec.length : 0;
  if (!length) return new Float32Array(0);
  const out = vec instanceof Float32Array ? new Float32Array(vec) : Float32Array.from(vec);
  return normalizeEmbeddingVectorInPlace(out);
};

export const normalizeEmbeddingBatchOutput = (output, count) => {
  const target = Math.max(0, Number(count) || 0);
  const emptyList = () => Array.from({ length: target }, () => new Float32Array(0));
  if (!output) return emptyList();

  const clampToCount = (list) => {
    const out = Array.isArray(list) ? list.slice(0, target) : [];
    while (out.length < target) out.push(new Float32Array(0));
    return out;
  };

  if (Array.isArray(output)) {
    const normalized = output.map((entry) => {
      if (!entry) return new Float32Array(0);
      const data = entry.data || entry;
      return data instanceof Float32Array ? data : Float32Array.from(data);
    });
    return clampToCount(normalized);
  }

  const dims = Array.isArray(output.dims) ? output.dims : null;
  const data = output.data
    ? (output.data instanceof Float32Array ? output.data : Float32Array.from(output.data))
    : null;

  if (!data || !dims || !dims.length) {
    return emptyList();
  }

  if (dims.length === 2) {
    const rows = Math.max(0, Math.floor(Number(dims[0]) || 0));
    const cols = Math.max(0, Math.floor(Number(dims[1]) || 0));
    if (!rows || !cols) return emptyList();
    const out = [];
    for (let i = 0; i < rows; i += 1) {
      out.push(data.slice(i * cols, (i + 1) * cols));
    }
    return clampToCount(out);
  }

  if (dims.length >= 3) {
    const rows = Math.max(0, Math.floor(Number(dims[0]) || 0));
    const cols = Math.max(0, Math.floor(Number(dims[dims.length - 1]) || 0));
    const inner = dims.slice(1, -1).reduce((acc, val) => {
      const parsed = Math.max(0, Math.floor(Number(val) || 0));
      return acc * (parsed || 0);
    }, 1);
    if (!rows || !cols || !inner) return emptyList();
    const expected = rows * inner * cols;
    if (data.length < expected) return emptyList();
    const out = [];
    for (let row = 0; row < rows; row += 1) {
      const vec = new Float32Array(cols);
      const rowOffset = row * inner * cols;
      for (let i = 0; i < inner; i += 1) {
        const base = rowOffset + i * cols;
        for (let c = 0; c < cols; c += 1) {
          vec[c] += data[base + c];
        }
      }
      for (let c = 0; c < cols; c += 1) {
        vec[c] = vec[c] / inner;
      }
      out.push(vec);
    }
    return clampToCount(out);
  }

  if (data.length && target === 1) {
    return [data];
  }

  return emptyList();
};
