/**
 * Pack minhash signatures into a dense u32 buffer.
 *
 * @param {{signatures?:Array<Array<number>>,chunks?:Array<object>}} input
 * @returns {{buffer:Buffer,dims:number,count:number,coercedRows:number}|null}
 */
export const packMinhashSignatures = ({ signatures, chunks }) => {
  const source = Array.isArray(signatures) && signatures.length ? signatures : null;
  const sourceChunks = Array.isArray(chunks) && chunks.length ? chunks : null;
  if (!source && !sourceChunks) return null;
  const resolveDims = () => {
    const values = source || sourceChunks;
    for (const entry of values) {
      const sig = source ? entry : entry?.minhashSig;
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
    for (const chunk of sourceChunks) {
      writeSignature(chunk?.minhashSig);
    }
  }
  return { buffer, dims, count, coercedRows };
};

