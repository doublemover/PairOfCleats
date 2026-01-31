export const DEFAULT_EMBEDDING_POOLING = 'mean';
export const DEFAULT_EMBEDDING_NORMALIZE = true;
export const DEFAULT_EMBEDDING_TRUNCATION = true;

let warnedQuantizationClamp = false;

const warnQuantizationClamp = (count, levels) => {
  if (warnedQuantizationClamp) return;
  warnedQuantizationClamp = true;
  const detail = Number.isFinite(count) ? ` (${count} value${count === 1 ? '' : 's'})` : '';
  const lvl = Number.isFinite(levels) ? ` (levels=${levels})` : '';
  console.warn(`[embeddings] Quantization clamped out-of-range vector values${detail}${lvl}.`);
};

const resolveQuantizationLevels = (value) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 256;
  const floored = Math.floor(raw);
  if (!Number.isFinite(floored)) return 256;
  if (floored < 2) return 2;
  if (floored > 256) return 256;
  return floored;
};

export const isVectorLike = (value) => (
  Array.isArray(value)
  || (ArrayBuffer.isView(value) && !(value instanceof DataView))
);

export const mergeEmbeddingVectors = ({ codeVector, docVector }) => {
  const code = isVectorLike(codeVector) ? codeVector : [];
  const doc = isVectorLike(docVector) ? docVector : [];
  const codeLen = code.length || 0;
  const docLen = doc.length || 0;
  if (!codeLen && !docLen) return new Float32Array(0);
  if (codeLen && !docLen) {
    return code instanceof Float32Array ? new Float32Array(code) : Float32Array.from(code);
  }
  if (docLen && !codeLen) {
    return doc instanceof Float32Array ? new Float32Array(doc) : Float32Array.from(doc);
  }
  if (codeLen !== docLen) {
    throw new Error(`[embeddings] embedding dims mismatch (code=${codeLen}, doc=${docLen}).`);
  }
  const merged = new Float32Array(codeLen);
  for (let i = 0; i < merged.length; i += 1) {
    const codeVal = Number(code[i] ?? 0);
    const docVal = Number(doc[i] ?? 0);
    const safeCode = Number.isFinite(codeVal) ? codeVal : 0;
    const safeDoc = Number.isFinite(docVal) ? docVal : 0;
    merged[i] = (safeCode + safeDoc) / 2;
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

export const quantizeEmbeddingVector = (vec, minVal = -1, maxVal = 1, levels = 256) => {
  if (!vec || typeof vec.length !== 'number') return [];
  const length = Math.max(0, Math.floor(vec.length));
  if (!length) return [];
  const out = new Array(length);
  const lvl = resolveQuantizationLevels(levels);
  const min = Number(minVal);
  const max = Number(maxVal);
  const range = max - min;
  if (!Number.isFinite(range) || range === 0) {
    return out.fill(0);
  }
  const scale = (lvl - 1) / range;
  const maxQ = lvl - 1;
  let clamped = 0;
  for (let i = 0; i < length; i += 1) {
    const f = Number(vec[i]);
    const q = Math.round(((f - min) * scale));
    if (q <= 0) {
      out[i] = 0;
      clamped += 1;
    } else if (q >= maxQ) {
      out[i] = maxQ;
      clamped += 1;
    } else {
      out[i] = q;
    }
  }
  if (clamped > 0) warnQuantizationClamp(clamped, lvl);
  return out;
};

export const quantizeEmbeddingVectorUint8 = (vec, minVal = -1, maxVal = 1, levels = 256) => {
  if (!vec || typeof vec !== 'object') return new Uint8Array(0);
  const length = Number.isFinite(vec.length) ? Math.max(0, Math.floor(vec.length)) : 0;
  if (!length) return new Uint8Array(0);

  const lvl = resolveQuantizationLevels(levels);
  const min = Number(minVal);
  const max = Number(maxVal);
  const range = max - min;

  const out = new Uint8Array(length);
  if (!Number.isFinite(range) || range === 0) return out;

  const scale = (lvl - 1) / range;
  const maxQ = lvl - 1;
  let clamped = 0;

  for (let i = 0; i < length; i += 1) {
    const f = vec[i];
    const q = Math.round((Number(f) - min) * scale);
    if (q <= 0) {
      out[i] = 0;
      clamped += 1;
    } else if (q >= maxQ) {
      out[i] = maxQ;
      clamped += 1;
    } else {
      out[i] = q;
    }
  }

  if (clamped > 0) warnQuantizationClamp(clamped, lvl);
  return out;
};

export const clampQuantizedVectorInPlace = (vec, maxValue = 255) => {
  if (!vec || typeof vec.length !== 'number') return 0;
  const max = Number.isFinite(maxValue) ? Math.floor(maxValue) : 255;
  let clamped = 0;
  for (let i = 0; i < vec.length; i += 1) {
    const raw = Number(vec[i]);
    let next = raw;
    if (!Number.isFinite(raw) || raw < 0) {
      next = 0;
    } else if (raw > max) {
      next = max;
    }
    if (next !== raw) {
      vec[i] = next;
      clamped += 1;
    }
  }
  return clamped;
};

export const clampQuantizedVectorsInPlace = (vectors, maxValue = 255) => {
  if (!Array.isArray(vectors)) return 0;
  let clamped = 0;
  for (const vec of vectors) {
    clamped += clampQuantizedVectorInPlace(vec, maxValue);
  }
  if (clamped > 0) warnQuantizationClamp(clamped, maxValue + 1);
  return clamped;
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
