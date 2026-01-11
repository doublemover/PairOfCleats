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
  tokens,
  seq,
  ngrams,
  chargrams,
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
  const fieldTokens = fieldedEnabled ? {
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
    doc: docText
      ? buildTokenSequence({
        text: docText,
        mode: tokenMode,
        ext,
        dictWords,
        dictConfig
      }).tokens
      : [],
    comment: commentFieldTokens,
    body: tokens
  } : null;
  const headline = getHeadline(chunk, tokens);
  const externalDocs = relationsEnabled
    ? buildExternalDocs(ext, fileRelations?.imports)
    : [];
  const chunkPayload = {
    file: relKey,
    ext,
    lang: languageId,
    segment: chunk.segment || null,
    start: chunk.start,
    end: chunk.end,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    kind: chunk.kind,
    name: chunk.name,
    tokens,
    seq,
    ngrams,
    chargrams,
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
