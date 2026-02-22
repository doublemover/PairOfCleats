import { minifyMinhashSignature, resolveMinhashSampledPlan } from '../../minhash.js';

/**
 * Resolve minhash emission mode and guard metadata.
 *
 * @param {{
 *   sparseEnabled?: boolean,
 *   minhashMaxDocs?: number,
 *   minhashStream?: boolean,
 *   chunks?: object[],
 *   log?: (message: string) => void
 * }} [input]
 * @returns {{
 *   allowMinhash: boolean,
 *   minhashSigs: unknown[],
 *   minhashGuard: {
 *     skipped?: boolean,
 *     sampled?: boolean,
 *     mode?: string,
 *     maxDocs: number,
 *     totalDocs: number,
 *     signatureLength?: number,
 *     sampledSignatureLength?: number,
 *     hashStride?: number,
 *     density?: number
 *   }|null
 * }}
 */
export const resolveMinhashOutputs = ({
  sparseEnabled,
  minhashMaxDocs,
  minhashStream,
  chunks,
  log
} = {}) => {
  const safeChunks = Array.isArray(chunks) ? chunks : [];
  let allowMinhash = false;
  let minhashSigs = [];
  let minhashGuard = null;
  const resolveSignatureLength = () => {
    for (const chunk of safeChunks) {
      if (Array.isArray(chunk?.minhashSig) && chunk.minhashSig.length > 0) {
        return chunk.minhashSig.length;
      }
    }
    return 0;
  };
  if (sparseEnabled) {
    const maxDocs = Number.isFinite(Number(minhashMaxDocs))
      ? Math.max(0, Math.floor(Number(minhashMaxDocs)))
      : 0;
    allowMinhash = !maxDocs || safeChunks.length <= maxDocs;
    if (allowMinhash) {
      minhashSigs = !minhashStream ? safeChunks.map((chunk) => chunk?.minhashSig) : [];
    } else if (maxDocs) {
      const sampledPlan = resolveMinhashSampledPlan({
        totalDocs: safeChunks.length,
        maxDocs,
        signatureLength: resolveSignatureLength()
      });
      if (sampledPlan) {
        minhashSigs = safeChunks.map((chunk) => minifyMinhashSignature(chunk?.minhashSig, sampledPlan));
        minhashGuard = {
          skipped: false,
          sampled: true,
          mode: sampledPlan.mode,
          maxDocs,
          totalDocs: safeChunks.length,
          signatureLength: sampledPlan.signatureLength,
          sampledSignatureLength: sampledPlan.sampledSignatureLength,
          hashStride: sampledPlan.hashStride,
          density: sampledPlan.density
        };
        if (typeof log === 'function') {
          log(
            `[postings] minhash sampled: ${safeChunks.length} docs exceeds max ${maxDocs}; ` +
            `dims=${sampledPlan.signatureLength} -> ${sampledPlan.sampledSignatureLength}, ` +
            `stride=${sampledPlan.hashStride}.`
          );
        }
      } else {
        minhashSigs = [];
        minhashGuard = { skipped: true, maxDocs, totalDocs: safeChunks.length };
        if (typeof log === 'function') {
          log(`[postings] minhash skipped: ${safeChunks.length} docs exceeds max ${maxDocs}.`);
        }
      }
    }
  }
  return {
    allowMinhash,
    minhashSigs,
    minhashGuard
  };
};
