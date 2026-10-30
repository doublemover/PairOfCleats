// Explicit canned search responses exercise parity-report arithmetic, not retrieval quality.
import { createFixtureRetrievalMetadata, bindFixtureRetrievalScores } from '../../helpers/retrieval-response-fixture.js';
const args = process.argv.slice(2);
const backend = args[args.indexOf('--backend') + 1];
const query = args[0];
if (!['alpha', 'beta', 'gamma'].includes(query) || !['memory', 'sqlite'].includes(backend)) {
  throw new Error('Explicit partial-rank parity fixture inputs required');
}
const ids = backend === 'memory' ? Array.from({ length: 10 }, (_, id) => id)
  : query === 'gamma' ? [...Array.from({ length: 9 }, (_, id) => id + 10), 0]
    : [...Array.from({ length: 8 }, (_, id) => id + 10), ...(query === 'alpha' ? [0, 1] : [1, 0])];
const retrieval = createFixtureRetrievalMetadata({ fixtureId: 'partial-rank-arithmetic-v1', backend });
console.log(JSON.stringify({ code: bindFixtureRetrievalScores(ids.map(id => ({ id, chunkUid: `partial-rank:${id}`, score: 1 })), retrieval),
  prose: bindFixtureRetrievalScores([{ chunkUid: 'partial-rank:prose-control', score: 1 }], retrieval, 'prose'), records: [], extractedProse: [],
  retrieval,
  stats: { elapsedMs: 1, memory: { rss: 1024 * 1024 } } }));
