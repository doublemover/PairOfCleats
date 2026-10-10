import { resolveSemanticSourcePolicy } from './policy.js';
import { semanticByteAdmissionFor } from './planning.js';
import { createTypeScriptSemanticCollector, TYPESCRIPT_ADAPTER_VERSION } from './typescript-collector.js';
import { getTypeScriptSyntaxIdentity } from '../../lang/typescript/syntax-context.js';
import { createSemanticSourceSnapshot } from './source.js';
import { createSyntaxPartitionId, semanticHash } from './identity.js';
import { createSemanticCollector, JAVASCRIPT_ADAPTER_VERSION } from './javascript-collector.js';
import { getJavaScriptSyntaxIdentity } from '../../lang/javascript/parse.js';
import { createSemanticPartitionSink } from '../build/artifacts/writers/semantic/partition.js';

/** Drain the already prepared parser once, awaiting durable writes at each yield. */
export const collectFileSemanticFacts = async ({ bytes, text, ast, ts, language, relPath,
  repositoryNamespace, stagingRoot, diskAccount, policy, signal, scheduleIo }) => {
  const snapshot = createSemanticSourceSnapshot({ bytes, repositoryNamespace, path: relPath, language });
  if (snapshot.text !== text) throw Object.assign(new Error('Semantic parser/source decoding mismatch.'),
    { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  const parser = language === 'typescript' ? getTypeScriptSyntaxIdentity(ast) : getJavaScriptSyntaxIdentity(ast);
  const parserIdentity = parser || { family: 'unavailable', version: '0', options: {} };
  policy = resolveSemanticSourcePolicy(policy, { sourceUnitId: snapshot.manifest.sourceUnitId, sourceHash: snapshot.manifest.byteHash, path: relPath, language });
  const structuralPolicy = { structure: 'complete', adapterVersion: 2, extraction: policy.identity.extraction, languageEnabled: policy.languages.includes(language) };
  const partitionId = createSyntaxPartitionId({ sourceUnitId: snapshot.manifest.sourceUnitId,
    parser: parserIdentity, extractor: { schemaVersion: 1, version: language === 'typescript' ? TYPESCRIPT_ADAPTER_VERSION : JAVASCRIPT_ADAPTER_VERSION }, structuralPolicy });
  const unavailable = !policy.languages.includes(language) ? { state: 'disabled', reason: 'language_policy_disabled' }
    : !['javascript', 'typescript'].includes(language) ? { state: 'unsupported', reason: 'syntax_adapter_pending' } : null;
  const createCollector = language === 'typescript' ? createTypeScriptSemanticCollector : createSemanticCollector;
  const collector = createCollector({ ts, ast: unavailable ? null : ast, unavailable, source: snapshot.manifest, partitionId, signal }, policy.storage);
  const sink = await createSemanticPartitionSink({ stagingRoot, source: snapshot.manifest,
    sourceBytes: bytes, partitionId,
    producerHash: semanticHash('semantic.syntax-producer.v1', parserIdentity),
    policyHash: semanticHash('semantic.structural-policy.v1', structuralPolicy),
    structuralSlots: collector.structuralSlots, diskAccount, signal, scheduleIo,
    byteAdmission: semanticByteAdmissionFor(diskAccount, policy.storage.maxQueuedBytes),
    batchRows: policy.storage.batchRows, batchBytes: policy.storage.batchBytes });
  const coverage = [];
  try {
    for (const batch of collector.batches) {
      for (const entry of batch.rows) if (entry.family === 'coverage') coverage.push(entry.row);
      await sink.appendBatch(batch);
    }
    return { source: snapshot.manifest, root: stagingRoot, partition: await sink.finalizeSource(), summary: collector.summary, coverage };
  } catch (error) { await sink.abort(); throw error; }
};
