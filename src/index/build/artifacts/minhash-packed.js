import { minifyMinhashSignature } from '../../minhash.js';

/** Yield one owned sampled row at a time, or borrow an unchanged ordinary row.
 * Chunks must remain stable until the artifact writer has consumed the stream. */
export function* iterateMinhashSignatures({ chunks, sampling = null }) {
  for (const chunk of chunks) {
    yield sampling
      ? minifyMinhashSignature(chunk?.minhashSig, sampling)
      : chunk?.minhashSig;
  }
}


/**
 * Pack minhash signatures into a dense u32 buffer.
 *
 * @param {{signatures?:Array<Array<number>>,chunks?:Array<object>,sampling?:object|null}} input
 * @returns {{buffer:Buffer,dims:number,count:number,coercedRows:number}|null}
 */
export const packMinhashSignatures = ({ signatures, chunks, sampling = null }) => {
  const source = Array.isArray(signatures) && signatures.length ? signatures : null;
  const sourceChunks = Array.isArray(chunks) && chunks.length ? chunks : null;
  if (!source && !sourceChunks) return null;
  const resolveDims = () => {
    const values = source || sourceChunks;
    for (const entry of values) {
      const sig = source ? entry : (sampling
        ? minifyMinhashSignature(entry?.minhashSig, sampling)
        : entry?.minhashSig);
      if (Array.isArray(sig) && sig.length) return sig.length;
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
    if (sig.length !== dims) coercedRows += 1;
    for (let i = 0; i < dims; i += 1) {
      const value = sig[i];
      view[offset] = Number.isFinite(value) ? value : 0;
      offset += 1;
    }
  };
  if (source) {
    for (const sig of source) {
      writeSignature(sig);
    }
  } else {
    for (const sig of iterateMinhashSignatures({ chunks: sourceChunks, sampling })) {
      writeSignature(sig);
    }
  }
  return { buffer, dims, count, coercedRows };
};
