import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createProcessChunksFixtureContext, processFixtureChunks } from './process-chunks-fixture.js';
import { createTokenizationEvidence, observedTokenizationExecution } from '../../../src/index/build/file-processor/tokenization-evidence.js';
import { attachEmbeddings } from '../../../src/index/build/file-processor/embeddings.js';
ensureTestingEnv(process.env);
const evidence = createTokenizationEvidence();
assert.equal(observedTokenizationExecution(evidence), 'not-yet-observed');
const controller = new AbortController(); let attempts = 0;
const { context } = createProcessChunksFixtureContext({ overrides: {
  signal: controller.signal, workerState: { tokenWorkerDisabled: false },
  tokenizationStats: { routeObservations: evidence },
  cachedLexicalBySpan: null,
  workerPool: { shouldUseForFile: () => true, tokenizeChunk: async () => {
    attempts += 1; controller.abort(); throw Object.assign(new Error('canceled'), { name: 'AbortError' });
  } }
} });
await assert.rejects(processFixtureChunks(context), { name: 'AbortError' });
assert.equal(attempts, 1);
assert.equal(context.workerState.tokenWorkerDisabled, false, 'cancellation is not a worker failure');
assert.equal(evidence.processedChunks, 0, 'aborted work is not recorded as successful inline execution');
await assert.rejects(attachEmbeddings({ chunks: [], embeddingEnabled: false, abortSignal: controller.signal }), { name: 'AbortError' });
console.log('token worker abort and observed execution evidence passed');
