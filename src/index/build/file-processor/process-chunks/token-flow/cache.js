import { getLanguageForFile } from '../../../../language-registry.js';
import {
  createFileLineTokenStream,
  createTokenClassificationRuntime,
  resolveTokenDictWords,
  sliceFileLineTokenStream
} from '../../../tokenization.js';
import { canUseLineTokenStreamSlice } from './parser-profile.js';

const resolveCacheMap = (container, key) => {
  let map = container.get(key);
  if (!map) {
    map = new Map();
    container.set(key, map);
  }
  return map;
};

/**
 * Build file-scoped token-flow caches and resolvers.
 *
 * Invariant: token stream cache keys intentionally remain mode+language only
 * to preserve existing cache identity and output behavior.
 *
 * @param {{
 *   tokenContext:any,
 *   fileBytes:number,
 *   heavyFileDownshift:boolean,
 *   tokenizationFileStreamEnabled:boolean,
 *   text:string,
 *   dictConfig:any,
 *   lineIndex:number[],
 *   relKey:string
 * }} input
 * @returns {{
 *   fileTokenContext:any,
 *   resolveEffectiveLanguage:(effectiveExt:string)=>any,
 *   resolveDictWordsForChunk:(chunkMode:string,chunkLanguageId:string|null)=>any,
 *   resolvePretokenizedChunk:(params:{
 *     effectiveTokenizeEnabled:boolean,
 *     tokenText:string,
 *     chunkText:string,
 *     chunkStart:number,
 *     chunkEnd:number,
 *     startLine:number,
 *     endLine:number,
 *     chunkMode:string,
 *     chunkLanguageId:string|null,
 *     effectiveExt:string|null,
 *     dictWordsForChunk:any
 *   })=>any
 * }}
 */
export const createTokenFlowCaches = ({
  tokenContext,
  fileBytes,
  heavyFileDownshift,
  tokenizationFileStreamEnabled,
  text,
  dictConfig,
  lineIndex,
  relKey
}) => {
  const fileTokenContext = tokenContext && typeof tokenContext === 'object'
    ? { ...tokenContext }
    : { tokenClassification: { enabled: false } };
  if (!fileTokenContext.tokenClassification || typeof fileTokenContext.tokenClassification !== 'object') {
    fileTokenContext.tokenClassification = { enabled: false };
  } else {
    fileTokenContext.tokenClassification = { ...fileTokenContext.tokenClassification };
  }
  if (heavyFileDownshift) {
    fileTokenContext.tokenClassification.enabled = false;
  }
  fileTokenContext.tokenClassificationRuntime = createTokenClassificationRuntime({
    context: fileTokenContext,
    fileBytes
  });

  const effectiveLangCache = new Map();
  const dictWordsCache = new Map();
  const fileTokenStreamCache = new Map();

  const resolveEffectiveLanguage = (effectiveExt) => {
    const langCacheKey = effectiveExt || '';
    if (effectiveLangCache.has(langCacheKey)) {
      return effectiveLangCache.get(langCacheKey);
    }
    const resolvedLanguage = getLanguageForFile(effectiveExt, relKey) || null;
    effectiveLangCache.set(langCacheKey, resolvedLanguage);
    return resolvedLanguage;
  };

  const resolveDictWordsForChunk = (chunkMode, chunkLanguageId) => {
    const modeKey = chunkMode || '';
    const languageKey = chunkLanguageId || '';
    const modeMap = resolveCacheMap(dictWordsCache, modeKey);
    if (!modeMap.has(languageKey)) {
      modeMap.set(
        languageKey,
        resolveTokenDictWords({
          context: fileTokenContext,
          mode: chunkMode,
          languageId: chunkLanguageId
        })
      );
    }
    return modeMap.get(languageKey);
  };

  const resolvePretokenizedChunk = ({
    effectiveTokenizeEnabled,
    tokenText,
    chunkText,
    chunkStart,
    chunkEnd,
    startLine,
    endLine,
    chunkMode,
    chunkLanguageId,
    effectiveExt,
    dictWordsForChunk
  }) => {
    if (!effectiveTokenizeEnabled || !tokenizationFileStreamEnabled || tokenText !== chunkText) {
      return null;
    }
    const canSlice = canUseLineTokenStreamSlice({
      chunkStart,
      chunkEnd,
      startLine,
      endLine,
      lineIndex,
      fileLength: text.length
    });
    if (!canSlice) {
      return null;
    }
    const modeKey = chunkMode || '';
    const languageKey = chunkLanguageId || '';
    const streamMap = resolveCacheMap(fileTokenStreamCache, modeKey);
    if (!streamMap.has(languageKey)) {
      streamMap.set(
        languageKey,
        createFileLineTokenStream({
          text,
          mode: chunkMode,
          ext: effectiveExt,
          dictWords: dictWordsForChunk,
          dictConfig
        })
      );
    }
    const tokenStream = streamMap.get(languageKey);
    return sliceFileLineTokenStream({
      stream: tokenStream,
      startLine,
      endLine
    });
  };

  return {
    fileTokenContext,
    resolveEffectiveLanguage,
    resolveDictWordsForChunk,
    resolvePretokenizedChunk
  };
};
