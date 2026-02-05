import { buildPostings } from '../../../src/index/build/postings.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const chunks = new Array(5).fill(0).map((_, idx) => ({
  tokens: [],
  tokenCount: 0,
  minhashSig: [idx, idx + 1, idx + 2]
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

if (postings.minhashSigs.length !== 0) {
  fail('Expected minhash signatures to be skipped when max docs guard triggers.');
}
if (!postings.minhashGuard || postings.minhashGuard.skipped !== true) {
  fail('Expected minhash guard to record a skipped event.');
}
if (postings.minhashGuard.maxDocs !== 2 || postings.minhashGuard.totalDocs !== 5) {
  fail('Expected minhash guard to record maxDocs and totalDocs.');
}

console.log('minhash max docs guard test passed');
