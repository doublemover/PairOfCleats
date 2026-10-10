import { collectSemanticOwnership } from './ownership.js';
import { createSemanticSourceSnapshot } from './source.js';
import { createSyntaxPartitionId, semanticHash } from './identity.js';
import { createSemanticCollector, JAVASCRIPT_ADAPTER_VERSION } from './javascript-collector.js';
import { createTypeScriptSemanticCollector, TYPESCRIPT_ADAPTER_VERSION } from './typescript-collector.js';
import { parseJavaScriptAst, getJavaScriptSyntaxIdentity } from '../../lang/javascript/parse.js';
import { createTypeScriptSyntaxContext, prepareTypeScriptSyntax } from '../../lang/typescript/syntax-context.js';
import { createSemanticPartitionSink } from '../build/artifacts/writers/semantic/partition.js';
import { createSemanticFactsRef } from './file-ref.js';
import { persistSemanticEvidence } from './lsp-evidence.js';
import { throwIfAborted } from '../../shared/abort.js';
const languages = { js: 'javascript', javascript: 'javascript', jsx: 'javascript', ts: 'typescript', typescript: 'typescript', tsx: 'typescript' };
export const embeddedSegmentKey = segment => [segment.start, segment.end, segment.languageId || 'unknown'].join(':');
export const getSegmentSemanticContext = (contexts, segment) => contexts?.get(embeddedSegmentKey(segment)) || {};
/** A separate immutable local source per exact segment, never a container AST on sliced text. */
export const collectEmbeddedSemanticSources = async ({ parentFacts, segments, text, repositoryNamespace,
  stagingRoot, storage, diskAccount, policy, signal = null, scheduleIo = fn => fn(), javascript = {}, typescript = {} }) => {
  const segmentFactsRefs = [], sourceFacts = [], syntaxContexts = new Map(), evidenceArtifacts = [];
  const parent = parentFacts.source;
  for (const segment of segments || []) {
    throwIfAborted(signal);
    if (!segment || segment.start === 0 && segment.end === text.length || segment.embeddingContext === 'prose' || !segment.segmentUid) continue;
    if (!Number.isSafeInteger(segment.start) || !Number.isSafeInteger(segment.end) || segment.start < 0 || segment.end > text.length || segment.end <= segment.start) throw new TypeError('Invalid embedded source range.');
    const key = embeddedSegmentKey(segment); if (syntaxContexts.has(key)) continue;
    const segmentText = typeof segment.text === 'string' ? segment.text : text.slice(segment.start, segment.end);
    const language = languages[segment.languageId] || segment.languageId || 'unknown';
    const quality = segmentText !== text.slice(segment.start, segment.end) ? 'synthetic' : segment.mappingQuality === 'coarse' || segment.mappingQuality === 'synthetic' ? segment.mappingQuality : 'exact';
    const map = { schemaVersion: 1, kind: 'embedded-linear-range', quality, parentSourceUnitId: parent.sourceUnitId, parentByteHash: parent.byteHash,
      parentStart: segment.start, parentEnd: segment.end, localStart: 0, localEnd: segmentText.length, coordinateUnit: 'utf16', segmentUid: segment.segmentUid, language };
    const identity = semanticHash('semantic.embedded-map.v1', map);
    const mapRef = await persistSemanticEvidence({ value: map, stagingRoot, diskAccount, inventory: evidenceArtifacts, signal });
    const bytes = Buffer.from(segmentText, 'utf8');
    const snapshot = createSemanticSourceSnapshot({ bytes, repositoryNamespace, path: parent.path + '.semantic-segments/' + identity + (language === 'typescript' ? '.ts' : '.js'), language,
      dialect: segment.languageId || null, mapping: { identity, parentSourceUnitId: parent.sourceUnitId, mapRef, quality } });
    if (snapshot.text !== segmentText) throw Object.assign(new Error('Embedded segment divides a surrogate pair or contains invalid decoded text.'), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
    const local = { ext: segment.languageId === 'tsx' ? '.tsx' : language === 'typescript' ? '.ts' : '.js' };
    let ast, ts, parser;
    if (language === 'typescript') {
      local.typeScriptSyntaxContext = createTypeScriptSyntaxContext();
      local.tsSyntax = prepareTypeScriptSyntax(segmentText, { ...typescript, ext: local.ext, typeScriptSyntaxContext: local.typeScriptSyntaxContext });
      ast = local.tsSyntax?.sourceFile; ts = local.tsSyntax?.ts; parser = local.tsSyntax?.identity;
    } else if (language === 'javascript') { local.jsAst = parseJavaScriptAst(segmentText, { ...javascript, ext: local.ext }); ast = local.jsAst; parser = getJavaScriptSyntaxIdentity(ast); }
    syntaxContexts.set(key, local);
    parser ||= { family: 'unavailable', version: '0', options: {} };
    const structuralPolicy = { structure: 'complete', adapterVersion: 1 };
    const partitionId = createSyntaxPartitionId({ sourceUnitId: snapshot.manifest.sourceUnitId, parser,
      extractor: { schemaVersion: 1, version: language === 'typescript' ? TYPESCRIPT_ADAPTER_VERSION : JAVASCRIPT_ADAPTER_VERSION }, structuralPolicy });
    const unavailable = !policy.languages.includes(language) ? { state: 'disabled', reason: 'language_policy_disabled' }
      : !languages[segment.languageId] ? { state: 'unsupported', reason: 'embedded_syntax_adapter_pending' } : null;
    const collector = (language === 'typescript' ? createTypeScriptSemanticCollector : createSemanticCollector)({ ts, ast: unavailable ? null : ast, unavailable, source: snapshot.manifest, partitionId, signal }, policy.storage);
    const sink = await createSemanticPartitionSink({ stagingRoot, source: snapshot.manifest, sourceBytes: bytes, partitionId,
      producerHash: semanticHash('semantic.syntax-producer.v1', parser), policyHash: semanticHash('semantic.structural-policy.v1', structuralPolicy), structuralSlots: collector.structuralSlots,
      diskAccount, signal, scheduleIo, batchRows: policy.storage.batchRows, batchBytes: policy.storage.batchBytes });
    const coverage = [];
    try {
      for (const batch of collector.batches) { for (const entry of batch.rows) if (entry.family === 'coverage') coverage.push(entry.row); await sink.appendBatch(batch); }
      const partition = await sink.finalizeSource();
      sourceFacts.push({ segment, bytes, facts: { source: snapshot.manifest, partition, coverage } });
      segmentFactsRefs.push({ segmentUid: segment.segmentUid, factsRef: createSemanticFactsRef({ source: snapshot.manifest, syntaxPartitionId: partitionId, storage, partitions: [partition], coverage }) });
    } catch (error) { await sink.abort(); throw error; }
  }
  return { segmentFactsRefs, sourceFacts, syntaxContexts, evidenceArtifacts };
};

/** Parent chunk coordinates are rebased once before the existing interval ownership join. */
export const collectEmbeddedSemanticOwnership = async ({ embedded, chunks, ...options }) => {
  const result = [];
  for (const { segment, bytes, facts } of embedded?.sourceFacts || []) {
    const localChunks = (facts.source.mapping.quality === 'exact' ? chunks : []).filter(chunk => chunk.segment?.segmentUid === segment.segmentUid && chunk.segment.start === segment.start && chunk.segment.end === segment.end)
      .map(chunk => ({ ...chunk, start: chunk.start - segment.start, end: chunk.end - segment.start }));
    result.push({ segmentUid: segment.segmentUid, factsRef: await collectSemanticOwnership({ ...options, facts, chunks: localChunks, bytes }) });
  }
  return result;
};
