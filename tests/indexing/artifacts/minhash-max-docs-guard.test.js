import { buildPostings } from '../../../src/index/build/postings.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const chunks = new Array(5).fill(0).map((_, idx) => ({
  tokens: [],
  tokenCount: 0,
  minhashSig: Array.from({ length: 32 }, (_value, offset) => (idx * 1000) + offset)
}));

const postings = await buildPostings({
  chunks,
  df: new Map(),
  tokenPostings: new Map(),
  docLengths: [],
  fieldPostings: {},
  fieldDocLengths: {},
  phrasePost: new Map(),
  triPost: new Map(),
  postingsConfig: { minhashMaxDocs: 2 },
  embeddingsEnabled: false,
  modelId: 'stub',
  useStubEmbeddings: true,
  log: () => {}
});

if (postings.minhashSigs.length !== chunks.length) {
  fail('Expected sampled minhash signatures for every chunk when max docs guard triggers.');
}
if (!postings.minhashGuard || postings.minhashGuard.sampled !== true || postings.minhashGuard.skipped !== false) {
  fail('Expected minhash guard to record sampled/minified mode.');
}
if (postings.minhashGuard.maxDocs !== 2 || postings.minhashGuard.totalDocs !== 5) {
  fail('Expected minhash guard to record maxDocs and totalDocs.');
}
if (postings.minhashGuard.sampledSignatureLength >= chunks[0].minhashSig.length) {
  fail('Expected sampled/minified signatures to reduce signature length.');
}
if (postings.minhashGuard.hashStride <= 1) {
  fail('Expected sampled/minified signatures to record stride > 1.');
}
if (postings.minhashStream !== false) {
  fail('Expected sampled minhash mode to disable streaming and use transformed signatures.');
}
if (postings.minhashSigs.some((sig) => !Array.isArray(sig) || sig.length !== postings.minhashGuard.sampledSignatureLength)) {
  fail('Expected sampled signatures to match sampledSignatureLength.');
}

console.log('minhash max docs guard test passed');
