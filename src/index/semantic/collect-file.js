import { createSemanticSourceSnapshot } from './source.js';
import { createSyntaxPartitionId, semanticHash } from './identity.js';
import { createSemanticCollector, JAVASCRIPT_ADAPTER_VERSION } from './javascript-collector.js';
import { getJavaScriptSyntaxIdentity } from '../../lang/javascript/parse.js';
import { createSemanticPartitionSink } from '../build/artifacts/writers/semantic/partition.js';

/** Drain the already prepared parser once, awaiting durable writes at each yield. */
export const collectFileSemanticFacts = async ({ bytes, text, ast, language, relPath,
  repositoryNamespace, stagingRoot, diskAccount, policy, signal, scheduleIo }) => {
  const snapshot = createSemanticSourceSnapshot({ bytes, repositoryNamespace, path: relPath, language });
  if (snapshot.text !== text) throw Object.assign(new Error('Semantic parser/source decoding mismatch.'),
    { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  const parser = getJavaScriptSyntaxIdentity(ast);
  const parserIdentity = parser || { family: 'unavailable', version: '0', options: {} };
  const structuralPolicy = { structure: 'complete', adapterVersion: 1 };
  const partitionId = createSyntaxPartitionId({ sourceUnitId: snapshot.manifest.sourceUnitId,
    parser: parserIdentity, extractor: { schemaVersion: 1, version: JAVASCRIPT_ADAPTER_VERSION }, structuralPolicy });
  const unavailable = !policy.languages.includes(language) ? { state: 'disabled', reason: 'language_policy_disabled' }
    : language !== 'javascript' ? { state: 'unsupported', reason: 'syntax_adapter_pending' } : null;
  const collector = createSemanticCollector({ ast: unavailable ? null : ast, unavailable, source: snapshot.manifest, partitionId, signal }, policy.storage);
  const sink = await createSemanticPartitionSink({ stagingRoot, source: snapshot.manifest,
    sourceBytes: bytes, partitionId,
    producerHash: semanticHash('semantic.syntax-producer.v1', parserIdentity),
    policyHash: semanticHash('semantic.structural-policy.v1', structuralPolicy),
    structuralSlots: collector.structuralSlots, diskAccount, signal, scheduleIo,
    batchRows: policy.storage.batchRows, batchBytes: policy.storage.batchBytes });
  try {
    for (const batch of collector.batches) await sink.appendBatch(batch);
    return { source: snapshot.manifest, root: stagingRoot, partition: await sink.finalizeSource(), summary: collector.summary };
  } catch (error) { await sink.abort(); throw error; }
};
