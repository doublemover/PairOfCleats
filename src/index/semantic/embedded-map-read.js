import path from 'node:path';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { throwIfAborted } from '../../shared/abort.js';
import { assertEmbeddedSourceMap } from '../../contracts/validators/embedded-source-map.js';
import { canonicalSemanticJson, semanticHash } from './identity.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
const boundary = (text, offset) => offset === 0 || offset === text.length
  || !(text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
    && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);

/** Read only the pinned embedded owner's map; generated/source-map protocols
 * have separate adapters and cannot masquerade as this linear-range framing. */
export const readRetainedEmbeddedSourceMap = async ({ store, source, parentFacts, signal = null }) => {
  throwIfAborted(signal);
  const match = /^semantic-evidence\/([a-f0-9]{64})\.json$/u.exec(source?.mapping?.mapRef || '');
  if (store?.backend !== 'artifact' || !match || !parentFacts
    || parentFacts.repositoryNamespace !== source.repositoryNamespace
    || parentFacts.sourceUnitId !== source.mapping.parentSourceUnitId) throw fail('Embedded map lacks its retained source/parent authority.');
  const { buffer } = await readVerifiedContainedFile(store.storeId, path.join(store.storeId, source.mapping.mapRef), {
    maxBytes: 65536, expectedHash: match[1], signal
  });
  const encoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  const map = assertEmbeddedSourceMap(JSON.parse(encoded));
  if (canonicalSemanticJson(map) !== encoded) throw fail('Embedded map is not in its canonical retained framing.');
  if (semanticHash('semantic.embedded-map.v1', map) !== source.mapping.identity
    || map.parentSourceUnitId !== parentFacts.sourceUnitId || map.parentByteHash !== parentFacts.sourceHash
    || map.quality !== source.mapping.quality || map.localEnd !== source.textLength
    || map.language !== source.language) throw fail('Embedded map identity differs from its retained source/parent.');
  return map;
};

/** Exact range qualification checks the actual two retained snapshots. A map
 * hash or equal local text alone cannot prove the selected parent occurrence. */
export const assertRetainedEmbeddedSourceRange = ({ map, source, localText, parentSource, parentText }) => {
  assertEmbeddedSourceMap(map);
  if (!source || !parentSource || typeof localText !== 'string' || typeof parentText !== 'string'
    || source.repositoryNamespace !== parentSource.repositoryNamespace
    || map.parentSourceUnitId !== parentSource.sourceUnitId || map.parentByteHash !== parentSource.byteHash
    || map.parentEnd > parentText.length || parentText.length !== parentSource.textLength
    || map.localEnd !== localText.length || localText.length !== source.textLength
    || !boundary(parentText, map.parentStart) || !boundary(parentText, map.parentEnd)
    || source.mapping?.identity !== semanticHash('semantic.embedded-map.v1', map)
    || source.mapping?.parentSourceUnitId !== parentSource.sourceUnitId || map.language !== source.language
    || source.mapping?.quality !== map.quality
    || map.quality === 'exact' && parentText.slice(map.parentStart, map.parentEnd) !== localText) {
    throw fail('Embedded range differs from its exact retained parent/source occurrence.');
  }
  return map;
};
