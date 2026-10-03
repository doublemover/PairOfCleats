import { createIndexState, appendChunk } from '../../../../src/index/build/state.js';
import { buildPostings } from '../../../../src/index/build/postings.js';

export const buildPostingsFromTokens = async ({ tokens, tokenIds = null }) => {
  const state = createIndexState();
  appendChunk(state, {
    tokens,
    ...(tokenIds ? { tokenIds } : {}),
    seq: tokens,
    file: 'sample.txt'
  }, {});

  return buildPostings({
    chunks: state.chunks,
    df: state.df,
    tokenPostings: state.tokenPostings,
    tokenIdMap: state.tokenIdMap,
    docLengths: state.docLengths,
    fieldPostings: state.fieldPostings,
    fieldDocLengths: state.fieldDocLengths,
    phrasePost: state.phrasePost,
    triPost: state.triPost,
    postingsConfig: {},
    postingsGuard: state.postingsGuard,
    embeddingsEnabled: false
  });
};

export const createPhrasePost = ({ count, modulo }) => {
  const phrasePost = new Map();
  for (let i = 0; i < count; i += 1) {
    phrasePost.set(`token-${String(i).padStart(4, '0')}`, [i % modulo]);
  }
  return phrasePost;
};

export const createPhraseSpillInput = ({
  phrasePost,
  postingsConfig,
  buildRoot = undefined
}) => ({
  chunks: [{ tokenCount: 1, tokens: ['alpha'] }],
  df: new Map(),
  tokenPostings: new Map([['alpha', [[0, 1]]]]),
  docLengths: [1],
  fieldPostings: null,
  fieldDocLengths: null,
  phrasePost: new Map(phrasePost),
  triPost: null,
  postingsConfig,
  embeddingsEnabled: false,
  log: () => {},
  ...(buildRoot ? { buildRoot } : {})
});

export const createPostingsQueueBackpressureCase = async ({
  createPostingsQueue,
  payload
}) => {
  const queue = createPostingsQueue({
    maxPending: 2,
    maxPendingRows: payload.rows,
    maxPendingBytes: payload.bytes,
    maxHeapFraction: 1
  });

  const first = await queue.reserve(payload);
  let secondResolved = false;
  const secondPromise = queue.reserve({ rows: 1, bytes: 1 }).then((reservation) => {
    secondResolved = true;
    return reservation;
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  return { first, queue, secondPromise, secondResolved: () => secondResolved };
};
