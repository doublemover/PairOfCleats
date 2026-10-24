import { assertQuantizedEmbeddingRow, resolveEmbeddingQuantizationSpec } from '../../../src/shared/embedding-quantization-spec.js';
import { buildQuantizedVectors } from './embed.js';

/** Empty doc bytes are a valid absence marker, independently of code/merged. */
export const hasReusableQuantizedChannels = (channels, { quantization, dims = null, hasDoc = null } = {}) => {
  if (!channels?.code?.length || !channels?.merged?.length || channels.doc == null) return false;
  try {
    const spec = resolveEmbeddingQuantizationSpec(quantization);
    const width = dims || channels.code.length;
    assertQuantizedEmbeddingRow(channels.code, { spec, dims: width, allowEmpty: false });
    assertQuantizedEmbeddingRow(channels.merged, { spec, dims: width, allowEmpty: false });
    assertQuantizedEmbeddingRow(channels.doc, { spec, dims: width });
    if (hasDoc === true && !channels.doc.length || hasDoc === false && channels.doc.length) return false;
    return true;
  } catch { return false; }
};

/** Reused rows have already passed input/identity admission. Never recompute an
 * absent doc from empty inference placeholders or treat it as missing reuse. */
export const buildOrReuseQuantizedChannels = ({ reused, codeVector, docVector, normalize, quantization }) => {
  if (reused && Object.values(reused).some(row => row != null)) {
    if (!hasReusableQuantizedChannels(reused, { quantization })) {
      throw Object.assign(new Error('Previously admitted quantized channels became invalid.'), { code: 'ERR_EMBEDDING_CACHE_REUSE_INVALID' });
    }
    return { quantizedCode: reused.code, quantizedDoc: reused.doc, quantizedMerged: reused.merged };
  }
  return buildQuantizedVectors({ codeVector, docVector, normalize, quantization });
};
