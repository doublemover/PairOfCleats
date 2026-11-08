import { MAX_JSON_BYTES } from '../../shared/artifact-io/constants.js';
import { loadPiecesManifest } from '../../shared/artifact-io/manifest.js';
import { loadChunkMeta, loadTokenPostings } from '../../shared/artifact-io/loaders.js';
import { hasLmdbArtifactFamily, loadLmdbOptionalArray, loadLmdbOptionalObject } from './optional-arrays.js';
import { loadLmdbMinhashArtifact } from './minhash.js';

const invalid = message => Object.assign(new Error(`[lmdb] ${message}`), { code: 'ERR_LMDB_ARTIFACT_INVALID' });

/** The builder consumes only one manifest-selected generation. Optional means
 * no declared family, never a malformed or metadata-only declared family.
 * Complete source admission precedes opening/replacing the native store.
 */
export const loadLmdbArtifactInputs = async (indexDir, { maxBytes = MAX_JSON_BYTES, mode = null } = {}) => {
  const manifest = loadPiecesManifest(indexDir, { maxBytes, strict: true });
  const chunkMeta = await loadChunkMeta(indexDir, { manifest, maxBytes, strict: true });
  const tokenPostings = loadTokenPostings(indexDir, { manifest, maxBytes, strict: true });
  if (!Array.isArray(tokenPostings?.vocab) || !Array.isArray(tokenPostings.postings)
    || tokenPostings.vocab.length !== tokenPostings.postings.length || !Array.isArray(tokenPostings.docLengths)
    || tokenPostings.docLengths.length !== chunkMeta.length) {
    throw invalid('Required token_postings payload does not match the admitted chunk generation.');
  }
  const array = name => loadLmdbOptionalArray(indexDir, name, manifest, { maxBytes });
  const object = name => loadLmdbOptionalObject(indexDir, name, manifest, { maxBytes });
  const fileMeta = await array('file_meta');
  const fieldTokens = await array('field_tokens');
  if (fieldTokens && fieldTokens.length !== chunkMeta.length) throw invalid('field_tokens row count differs from chunk_meta.');
  const fileRelations = await array('file_relations');
  const repoMap = await array('repo_map');
  const fieldPostings = await object('field_postings');
  const phraseNgrams = await object('phrase_ngrams');
  const chargramPostings = await object('chargram_postings');
  const indexState = await object('index_state');
  const sourceMode = indexState?.fields?.mode ?? indexState?.mode ?? manifest.mode ?? null;
  if (mode && sourceMode && sourceMode !== mode) throw invalid(`Source mode ${sourceMode} differs from requested ${mode}.`);
  const minhashSignatures = hasLmdbArtifactFamily(manifest, 'minhash_signatures')
    ? await loadLmdbMinhashArtifact(indexDir, { manifest, maxBytes, strict: true }) : null;
  if (hasLmdbArtifactFamily(manifest, 'minhash_signatures') && !minhashSignatures) {
    throw invalid('Declared minhash_signatures family has no payload.');
  }
  return { manifest, chunkMeta, tokenPostings, fileMeta, fieldTokens, fileRelations, repoMap,
    fieldPostings, phraseNgrams, chargramPostings, minhashSignatures, indexState };
};
