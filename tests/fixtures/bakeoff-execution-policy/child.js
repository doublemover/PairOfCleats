import fs from 'node:fs/promises';
import path from 'node:path';
import { getEnvConfig } from '../../../src/shared/env/runtime.js';
import { stubEmbedding } from '../../../src/shared/embedding.js';
import { resolveEmbeddingSamplingConfig, selectDeterministicFileSample } from '../../../tools/build/embeddings/sampling.js';
import { createEmbeddingSamplingObservation } from '../../../tools/build/embeddings/sampling-observation.js';

const args = process.argv.slice(2), phase = args[0], root = args[1];
// This fixture can never activate a real provider, including on a lost handoff.
if (process.env.PAIROFCLEATS_TESTING !== '1' || process.env.PAIROFCLEATS_EMBEDDINGS !== 'stub'
  || phase === 'compare' && !args.includes('--stub-embeddings')) throw new Error('Fixture refuses real/off/unqualified provider execution.');
const files = ['a.txt', 'b.txt', 'c.txt'];
const entries = files.map((file, index) => [file, [{ index }]]);
const sampling = resolveEmbeddingSamplingConfig({ embeddingsConfig: { sampleFiles: 5 }, env: getEnvConfig() });
const selected = sampling.maxFiles ? selectDeterministicFileSample({ fileEntries: entries, mode: 'code',
  maxFiles: sampling.maxFiles, seed: sampling.seed }) : entries;
const vectors = [];
for (const [file] of selected) vectors.push(stubEmbedding(await fs.readFile(path.join(root, file), 'utf8'), 8));
const receipt = createEmbeddingSamplingObservation({ mode: 'code', sampling, selectedEntries: selected,
  eligibleFiles: 3, eligibleChunks: 3, completedFiles: selected.length, completedChunks: vectors.length,
  embeddingGeneration: { fixture: 'closed-three-file-selection' }, useStubEmbeddings: true });
process.stdout.write(JSON.stringify({ phase, sampling, selectedFiles: selected.map(([file]) => file),
  vectorDimensions: vectors.map(vector => vector.length), receipt }));
