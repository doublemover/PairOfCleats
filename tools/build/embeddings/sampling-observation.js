import crypto from 'node:crypto';
import { toPosix } from '../../../src/shared/file-paths.js';
import { stableStringify } from '../../../src/shared/stable-json.js';

export const EMBEDDING_SAMPLING_OBSERVATION_VERSION = 1;
const count = value => Number.isSafeInteger(value) && value >= 0;
export const createEmbeddingSamplingObservation = ({ mode, sampling, selectedEntries, eligibleFiles, eligibleChunks,
  completedFiles, completedChunks, embeddingGeneration, useStubEmbeddings }) => {
  const selectedFiles = selectedEntries.length;
  const selectedChunks = selectedEntries.reduce((sum, [, items]) => sum + items.length, 0);
  if (![eligibleFiles, eligibleChunks, selectedFiles, selectedChunks, completedFiles, completedChunks].every(count)
    || selectedFiles > eligibleFiles || selectedChunks > eligibleChunks || completedFiles > selectedFiles || completedChunks > selectedChunks
    || new Set(selectedEntries.map(([file]) => toPosix(file))).size !== selectedFiles
    || selectedEntries.some(([file, items]) => typeof file !== 'string' || !Array.isArray(items)
      || items.some(item => !count(item.index)))) {
    throw new TypeError('Embedding sampling observation requires exact eligible, selected and completed counts.');
  }
  const hash = crypto.createHash('sha256');
  hash.update(stableStringify({ mode, sampling }));
  // Membership is compactly bound to the generation; no source text or full
  // selected-file list is retained in the persisted diagnostic receipt.
  for (const [file, items] of [...selectedEntries].sort(([left], [right]) => toPosix(left).localeCompare(toPosix(right)))) {
    hash.update(stableStringify([toPosix(file), items.map(item => item.index)]));
  }
  const selectionCompleted = completedFiles === selectedFiles && completedChunks === selectedChunks;
  return { version: EMBEDDING_SAMPLING_OBSERVATION_VERSION, mode,
    scope: 'stage3-file-selection-and-completed-work', sampling: { maxFiles: sampling.maxFiles, seed: sampling.seed },
    eligibleFiles, eligibleChunks, selectedFiles, selectedChunks, completedFiles, completedChunks,
    selectedInputIdentity: 'sha256:' + hash.digest('hex'), embeddingGeneration,
    executionKind: useStubEmbeddings ? 'stub' : 'provider-policy', selectionCompleted,
    fullCoverage: eligibleFiles > 0 && eligibleChunks > 0 && selectionCompleted
      && selectedFiles === eligibleFiles && selectedChunks === eligibleChunks };
};

/** A requested full profile is not a retained-index coverage witness. */
export const projectEmbeddingSamplingObservation = (state, mode) => {
  const receipt = state?.extensions?.embeddingSampling;
  if (state?.embeddings?.ready !== true || state.embeddings.pending !== false || receipt?.version !== EMBEDDING_SAMPLING_OBSERVATION_VERSION
    || receipt.mode !== mode || receipt.scope !== 'stage3-file-selection-and-completed-work'
    || !/^(?:sha256:)[a-f0-9]{64}$/u.test(receipt.selectedInputIdentity || '')
    || !['eligibleFiles', 'eligibleChunks', 'selectedFiles', 'selectedChunks', 'completedFiles', 'completedChunks'].every(key => count(receipt[key]))
    || receipt.selectedFiles > receipt.eligibleFiles || receipt.selectedChunks > receipt.eligibleChunks
    || receipt.completedFiles !== receipt.selectedFiles || receipt.completedChunks !== receipt.selectedChunks
    || !['stub', 'provider-policy'].includes(receipt.executionKind)
    || !receipt.embeddingGeneration || stableStringify(receipt.embeddingGeneration) !== stableStringify(state.embeddings.embeddingGeneration)) {
    return { observation: 'unknown', reason: 'missing-or-unqualified-retained-selection' };
  }
  const fullCoverage = receipt.eligibleFiles > 0 && receipt.eligibleChunks > 0
    && receipt.selectedFiles === receipt.eligibleFiles && receipt.selectedChunks === receipt.eligibleChunks;
  return { observation: 'observed', version: receipt.version, mode: receipt.mode, scope: receipt.scope,
    eligibleFiles: receipt.eligibleFiles, eligibleChunks: receipt.eligibleChunks,
    selectedFiles: receipt.selectedFiles, selectedChunks: receipt.selectedChunks,
    completedFiles: receipt.completedFiles, completedChunks: receipt.completedChunks,
    selectedInputIdentity: receipt.selectedInputIdentity,
    generationIdentity: 'sha256:' + crypto.createHash('sha256').update(stableStringify(receipt.embeddingGeneration)).digest('hex'),
    executionKind: receipt.executionKind === 'stub' ? 'stub' : 'provider-policy', fullCoverage };
};
