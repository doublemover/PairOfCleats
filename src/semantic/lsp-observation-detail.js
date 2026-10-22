import path from 'node:path';
import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { readVerifiedContainedFile } from '../shared/contained-file.js';
import { throwIfAborted } from '../shared/abort.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_LSP_OBSERVATION_IDENTITY' });

/** Hydrate a retained observation through its canonical evidence record. This
 * returns source-qualified provider evidence, without declaring complete binding,
 * runtime dispatch or subtype knowledge from an LSP response. */
export const readLspObservationDetail = async ({ store, ref, evidenceRoot = store.storeId,
  maxBytes = 1048576, signal = null }) => {
  throwIfAborted(signal);
  if (store.backend !== 'artifact' || path.resolve(evidenceRoot) !== path.resolve(store.storeId)
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) throw fail('Evidence root or read bound is not admitted.');
  const [record] = await store.getRecords([ref], ['data'], { signal });
  if (record?.kind !== 'evidence' || record.data.evidenceKind !== 'lsp-structured-observation') throw fail('Record is not structured LSP evidence.');
  const match = /^semantic-evidence\/([a-f0-9]{64})\.json$/u.exec(record.data.artifactRef || '');
  if (!match) throw fail('Invalid structured observation evidence reference.');
  const { buffer } = await readVerifiedContainedFile(evidenceRoot, path.join(evidenceRoot, record.data.artifactRef), {
    maxBytes, expectedHash: match[1], signal
  });
  const observation = JSON.parse(buffer.toString('utf8'));
  let source = null;
  for await (const manifest of store.iterateRows(ref.partitionId, 'semantic_sources', { signal })) {
    if (source) throw fail('Multiple observation source manifests.');
    source = manifest;
  }
  if (!source || observation.schemaVersion !== 1 || observation.identity?.sourceUnitId !== source.sourceUnitId
    || observation.identity.sourceHash !== source.byteHash || record.data.sourceRef !== source.sourceUnitId
    || canonicalSemanticJson(observation.identity.generation) !== canonicalSemanticJson(store.generation)
    || observation.method !== record.data.method || !Array.isArray(observation.facts)) throw fail('Observation source/generation identity differs from its canonical record.');
  await store.verifySource(source, { signal });
  return { recordRef: ref, generation: store.generation, sourceUnitId: source.sourceUnitId,
    sourceHash: source.byteHash, observation,
    navigationCandidates: observation.facts.filter(fact => fact.target?.state === 'exact').map(fact => ({
      sourceUnitId: fact.target.sourceUnitId, sourceHash: fact.target.sourceHash, span: fact.target.span,
      method: observation.method, evidenceRef: ref, coverage: 'provider_observation'
    })) };
};
