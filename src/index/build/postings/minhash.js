export const resolveMinhashOutputs = ({
  sparseEnabled,
  minhashMaxDocs,
  minhashStream,
  chunks,
  log
} = {}) => {
  let allowMinhash = false;
  let minhashSigs = [];
  let minhashGuard = null;
  if (sparseEnabled) {
    allowMinhash = !minhashMaxDocs || chunks.length <= minhashMaxDocs;
    minhashSigs = allowMinhash && !minhashStream ? chunks.map((c) => c.minhashSig) : [];
    minhashGuard = (!allowMinhash && minhashMaxDocs)
      ? { skipped: true, maxDocs: minhashMaxDocs, totalDocs: chunks.length }
      : null;
    if (!allowMinhash && typeof log === 'function') {
      log(`[postings] minhash skipped: ${chunks.length} docs exceeds max ${minhashMaxDocs}.`);
    }
  }
  return {
    allowMinhash,
    minhashSigs,
    minhashGuard
  };
};
