import fs from 'node:fs/promises';
import path from 'node:path';
import { writePiecesManifest } from './artifact-io-fixture.js';

/** Explicit deterministic protocol data; this does not load a native adapter. */
export const writeTantivySourceFixture = async (indexDir, { order = ['alpha', 'beta'], buildId = 'source-A' } = {}) => {
  await fs.mkdir(indexDir, { recursive: true });
  const chunkMeta = order.map((chunkId, id) => ({ id, chunkId, file: `src/${chunkId}.js`, start: 0, end: 4 }));
  const tokenIndex = { vocab: ['needle'], postings: [order.map((_, id) => [id, 1])],
    docLengths: order.map(() => 1), totalDocs: order.length, avgDocLen: order.length ? 1 : 0 };
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(chunkMeta));
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify(tokenIndex));
  await writePiecesManifest(indexDir, [
    { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
    { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' }
  ], { buildId });
  return { chunkMeta, tokenIndex };
};

export const writeTantivyPayloadFixture = async ({ indexPath, chunkMeta }) => {
  await fs.writeFile(path.join(indexPath, 'native-protocol-fixture.json'), JSON.stringify(chunkMeta.map(row => row.chunkId)));
};
