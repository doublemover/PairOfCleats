import { minifyMinhashSignature, normalizeMinhashSampling } from '../../minhash.js';

const resolveChunkSampling = (sampling) => {
  if (sampling == null) return null;
  const resolved = normalizeMinhashSampling(sampling);
  if (!resolved) throw new Error('Invalid minhash sampling metadata');
  return resolved;
};

/** Repeatable rows for JSON measurement/writing; only the current sampled row is allocated. */
export const createMinhashSignatureIterable = ({ signatures, chunks, sampling } = {}) => {
  if (Array.isArray(signatures) && signatures.length) return signatures;
  if (!Array.isArray(chunks) || !chunks.length) return [];
  const plan = resolveChunkSampling(sampling);
  return {
    *[Symbol.iterator]() {
      for (const chunk of chunks) {
        yield plan ? minifyMinhashSignature(chunk?.minhashSig, plan) : chunk?.minhashSig;
      }
    }
  };
};

/**
 * Pack minhash signatures into a dense u32 buffer.
 *
 * Sampling applies only to chunk input; explicit signatures are already transformed.
 *
 * @param {{signatures?:Array<Array<number>>,chunks?:Array<object>,sampling?:object}} input
 * @returns {{buffer:Buffer,dims:number,count:number,coercedRows:number}|null}
 */
export const packMinhashSignatures = ({ signatures, chunks, sampling }) => {
  const source = Array.isArray(signatures) && signatures.length ? signatures : null;
  const sourceChunks = Array.isArray(chunks) && chunks.length ? chunks : null;
  if (!source && !sourceChunks) return null;
  const plan = source ? null : resolveChunkSampling(sampling);
  const resolveDims = () => {
    const values = source || sourceChunks;
    for (const entry of values) {
      const sig = source ? entry : entry?.minhashSig;
      if (Array.isArray(sig) && sig.length) {
        return plan ? Math.min(sig.length, plan.sampledSignatureLength) : sig.length;
      }
    }
    return 0;
  };
  const dims = resolveDims();
  if (!dims) return null;
  const count = source ? source.length : sourceChunks.length;
  const total = dims * count;
  const buffer = Buffer.allocUnsafe(total * 4);
  const view = new Uint32Array(buffer.buffer, buffer.byteOffset, total);
  let coercedRows = 0;
  let offset = 0;
  const writeSignature = (sig) => {
    if (!Array.isArray(sig)) {
      coercedRows += 1;
      for (let i = 0; i < dims; i += 1) {
        view[offset] = 0;
        offset += 1;
      }
      return;
    }
    const rowDims = plan ? Math.min(sig.length, plan.sampledSignatureLength) : sig.length;
    if (rowDims !== dims) coercedRows += 1;
    for (let i = 0; i < dims; i += 1) {
      // Match minifyMinhashSignature, including short rows and value coercion,
      // directly in the final buffer instead of allocating a sampled row first.
      const sampledValue = plan && i < rowDims ? Number(sig[i * plan.hashStride]) : null;
      const value = plan
        ? (Number.isFinite(sampledValue) && sampledValue >= 0 ? Math.floor(sampledValue) >>> 0 : 0)
        : sig[i];
      view[offset] = Number.isFinite(value) ? value : 0;
      offset += 1;
    }
  };
  if (source) {
    for (const sig of source) {
      writeSignature(sig);
    }
  } else {
    for (const chunk of sourceChunks) {
      writeSignature(chunk?.minhashSig);
    }
  }
  return { buffer, dims, count, coercedRows };
};
