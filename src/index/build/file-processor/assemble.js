import { getHeadline } from '../../headline.js';
import { getFieldWeight } from '../../field-weighting.js';
import { buildMetaV2 } from '../../metadata-v2.js';
import { buildTokenSequence } from '../tokenization.js';
import { buildExternalDocs } from './meta.js';
import { log } from '../../../shared/progress.js';

export function buildChunkPayload({
  chunk,
  rel,
  relKey,
  ext,
  effectiveExt,
  languageId,
  containerLanguageId,
  fileHash,
  fileHashAlgo,
  fileSize,
  tokens,
  identifierTokens,
  keywordTokens,
  operatorTokens,
  literalTokens,
  seq,
  codeRelations,
  docmeta,
  stats,
  complexity,
  lint,
  preContext,
  postContext,
  minhashSig,
  commentFieldTokens,
  dictWords,
  dictConfig,
  postingsConfig,
  tokenMode,
  fileRelations,
  relationsEnabled,
  toolInfo,
  gitMeta,
  analysisPolicy
}) {
  const weight = getFieldWeight(chunk, rel);
  const resolvedExt = effectiveExt || ext;
  const docText = typeof docmeta.doc === 'string' ? docmeta.doc : '';
  const fieldedEnabled = postingsConfig?.fielded !== false;
  const tokenClassificationEnabled = postingsConfig?.tokenClassification?.enabled === true;
  const wantsFieldTokens = fieldedEnabled
    || postingsConfig?.chargramSource === 'fields'
    || postingsConfig?.phraseSource === 'fields';
  let fieldTokens = null;
  if (wantsFieldTokens) {
    const docTokens = tokenMode !== 'code'
      ? (docText
        ? buildTokenSequence({
          text: docText,
          mode: tokenMode,
          ext: resolvedExt,
          dictWords,
          dictConfig,
          includeSeq: false
        }).tokens
        : tokens)
      : [];
    const resolvedBodyTokens = tokenClassificationEnabled && Array.isArray(identifierTokens)
      ? identifierTokens
      : tokens;
    fieldTokens = {
      name: chunk.name ? buildTokenSequence({
        text: chunk.name,
        mode: tokenMode,
        ext: resolvedExt,
        dictWords,
        dictConfig,
        includeSeq: false
      }).tokens : [],
      signature: docmeta?.signature
        ? buildTokenSequence({
          text: docmeta.signature,
          mode: tokenMode,
          ext: resolvedExt,
          dictWords,
          dictConfig,
          includeSeq: false
        }).tokens
        : [],
      doc: docTokens,
      comment: Array.isArray(commentFieldTokens) ? commentFieldTokens : [],
      body: fieldedEnabled ? resolvedBodyTokens : [],
      ...(tokenClassificationEnabled ? {
        keyword: Array.isArray(keywordTokens) ? keywordTokens : [],
        operator: Array.isArray(operatorTokens) ? operatorTokens : [],
        literal: Array.isArray(literalTokens) ? literalTokens : []
      } : {})
    };
  }
  const headline = getHeadline(chunk, tokens);
  const externalDocs = relationsEnabled
    ? buildExternalDocs(resolvedExt, fileRelations?.imports)
    : [];
  const chunkPayload = {
    file: relKey,
    ext,
    lang: languageId,
    containerLanguageId: containerLanguageId || null,
    spanIndex: Number.isFinite(chunk.spanIndex) ? chunk.spanIndex : null,
    fileHash: fileHash || null,
    fileHashAlgo: fileHashAlgo || null,
    fileSize: Number.isFinite(fileSize) ? fileSize : null,
    chunkUid: chunk.chunkUid || null,
    virtualPath: chunk.virtualPath || null,
    identity: chunk.identity || null,
    segment: chunk.segment || null,
    start: chunk.start,
    end: chunk.end,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    kind: chunk.kind,
    name: chunk.name,
    tokens,
    seq,
    codeRelations,
    docmeta,
    stats,
    complexity,
    lint,
    headline,
    preContext,
    postContext,
    embedding: [],
    embed_doc: [],
    embed_code: [],
    minhashSig,
    ...(fieldTokens ? { fieldTokens } : {}),
    weight,
    ...gitMeta,
    externalDocs
  };
  chunkPayload.metaV2 = buildMetaV2({
    chunk: chunkPayload,
    docmeta,
    toolInfo,
    analysisPolicy
  });
  if (analysisPolicy?.metadata?.enabled !== false && !chunkPayload.metaV2) {
    log(
      `[metaV2] missing metadata for ${relKey} ` +
      `(${chunkPayload.start}-${chunkPayload.end})`
    );
  }
  return chunkPayload;
}
