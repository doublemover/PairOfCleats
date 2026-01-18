import { getHeadline } from '../../headline.js';
import { getFieldWeight } from '../../field-weighting.js';
import { buildMetaV2 } from '../../metadata-v2.js';
import { buildTokenSequence } from '../tokenization.js';
import { buildExternalDocs } from './meta.js';

export function buildChunkPayload({
  chunk,
  rel,
  relKey,
  ext,
  languageId,
  fileHash,
  fileHashAlgo,
  fileSize,
  tokens,
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
  gitMeta
}) {
  const weight = getFieldWeight(chunk, rel);
  const docText = typeof docmeta.doc === 'string' ? docmeta.doc : '';
  const fieldedEnabled = postingsConfig?.fielded !== false;
  const wantsFieldTokens = fieldedEnabled
    || postingsConfig?.chargramSource === 'fields'
    || postingsConfig?.phraseSource === 'fields';
  const fieldTokens = wantsFieldTokens ? {
    name: chunk.name ? buildTokenSequence({
      text: chunk.name,
      mode: tokenMode,
      ext,
      dictWords,
      dictConfig
    }).tokens : [],
    signature: docmeta?.signature
      ? buildTokenSequence({
        text: docmeta.signature,
        mode: tokenMode,
        ext,
        dictWords,
        dictConfig
      }).tokens
      : [],
    doc: (docText && tokenMode !== 'code')
      ? buildTokenSequence({
        text: docText,
        mode: tokenMode,
        ext,
        dictWords,
        dictConfig
      }).tokens
      : [],
    comment: commentFieldTokens,
    body: fieldedEnabled ? tokens : []
  } : null;
  const headline = getHeadline(chunk, tokens);
  const externalDocs = relationsEnabled
    ? buildExternalDocs(ext, fileRelations?.imports)
    : [];
  const chunkPayload = {
    file: relKey,
    ext,
    lang: languageId,
    fileHash: fileHash || null,
    fileHashAlgo: fileHashAlgo || null,
    fileSize: Number.isFinite(fileSize) ? fileSize : null,
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
    toolInfo
  });
  return chunkPayload;
}
