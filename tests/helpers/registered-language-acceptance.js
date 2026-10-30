import assert from 'node:assert/strict';
import { buildLanguageContext, buildChunkRelations } from '../../src/index/language-registry.js';
import { smartChunk } from '../../src/index/chunking/dispatch.js';
import { buildCallIndex } from '../../src/index/build/file-processor/relations.js';
import { attachCallDetailsByChunkIndex } from '../../src/index/build/file-processor/process-chunks/dedupe.js';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';
import { prepareChunkIds } from '../../src/index/build/file-processor/process-chunks/ids.js';
import { buildLineIndex } from '../../src/shared/lines.js';
import { nativeDeclarationOptions } from './native-declaration-acceptance.js';
import { enrichFlowFixture, assembleFlowFixture } from './chunk-flow-fixture.js';

export const prepareRegisteredLanguage = async ({ text, ext, relPath = 'fixture' + ext, options = nativeDeclarationOptions }) => {
  const input = { text, ext, relPath, mode:'code', options };
  const { lang, context } = await buildLanguageContext(input);
  assert.ok(lang, relPath);
  const chunks = smartChunk({ ...input, context:{...context,treeSitter:options.treeSitter} });
  assert.ok(chunks?.length, relPath);
  const raw = lang.buildRelations({...input,context});
  const relations = filterRawRelationsWithLexicon(raw,{languageId:lang.id,relKey:relPath});
  const index = buildCallIndex(relations); attachCallDetailsByChunkIndex(index,chunks);
  await prepareChunkIds({ chunks,text,relKey:relPath,containerExt:ext,containerLanguageId:lang.id,
    lineIndex:buildLineIndex(text),vfsManifestConcurrency:1,strict:true });
  const projected = chunks.map((chunk,chunkIndex) => buildChunkRelations({ lang,chunk,fileRelations:relations,callIndex:index,chunkIndex }));
  const payloads = chunks.map((chunk,chunkIndex) => {
    const docmeta = enrichFlowFixture({text,chunk,lang,context,options,enabled:false});
    return assembleFlowFixture({text,chunk,docmeta,lang:lang.id,ext,codeRelations:projected[chunkIndex],emitFieldTokens:true});
  });
  return { input,lang,context,chunks,raw,relations,projected,payloads };
};
