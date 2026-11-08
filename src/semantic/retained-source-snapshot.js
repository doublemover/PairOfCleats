import path from 'node:path';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { createSemanticSourceSnapshot } from '../index/semantic/source.js';
import { admitOwnedSemanticSourceSnapshot } from '../index/semantic/source-snapshot-admission.js';
import { readVerifiedContainedFile } from '../shared/contained-file.js';
import { throwIfAborted } from '../shared/abort.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });

/** One bounded capture owns original bytes, decoding and every manifest field.
 * This uses the pinned artifact store only, never a same-named worktree file.
 * Callers keep their existing task/response budgets and reader leases. */
export const readRetainedSemanticSourceSnapshot = async ({ store, partitionId,
  maxBytes = 1024 * 1024, repositoryNamespace = null, signal = null }) => {
  throwIfAborted(signal);
  if (store?.backend !== 'artifact' || typeof store.storeId !== 'string'
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) {
    throw new TypeError('Bounded retained artifact source capture required.');
  }
  let source = null;
  for await (const row of store.iterateRows(partitionId, 'semantic_sources', { signal, batchRows: 1 })) {
    if (source) throw fail('Multiple retained source manifests.');
    source = assertSemanticEnvelope('source', row);
  }
  if (!source || source.encoding !== 'utf8' || source.coordinateUnit !== 'utf16'
    || source.decoding !== 'utf8-fatal-preserve-bom-v1') throw fail('Retained text source coordinates are unavailable.');
  if (repositoryNamespace !== null && source.repositoryNamespace !== repositoryNamespace) throw fail('Retained source repository differs from requested world.');
  const { buffer: bytes } = await readVerifiedContainedFile(store.storeId,
    path.join(store.storeId, 'semantic-sources', source.byteHash + '.utf8'), {
      maxBytes, expectedHash: source.byteHash, expectedBytes: source.byteLength, signal
    });
  const snapshot = createSemanticSourceSnapshot({ bytes, repositoryNamespace: source.repositoryNamespace,
    path: source.path, language: source.language, dialect: source.dialect, mapping: source.mapping });
  if (canonicalSemanticJson(snapshot.manifest) !== canonicalSemanticJson(source)) throw fail('Retained source manifest differs from its captured bytes.');
  // The same owner used by task lenses checks complete canonical metadata.
  admitOwnedSemanticSourceSnapshot(snapshot, { maxBytes, repositoryNamespace });
  throwIfAborted(signal);
  return { bytes, text: snapshot.text, source: snapshot.manifest, snapshot };
};
