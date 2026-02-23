import util from 'node:util';
import {
  classifyTokenBuckets,
  tokenizeChunkText
} from '../../../tokenization.js';
import { formatError } from '../../meta.js';
import {
  applyTokenClassification,
  createDisabledTokenPayload
} from './token-assembly.js';

/**
 * Create a file-scoped chunk tokenizer.
 *
 * Fallback/retention contract:
 * - Worker tokenization is attempted while available.
 * - On first worker failure, fallback is sticky for the rest of the file:
 *   `workerState.tokenWorkerDisabled` is set and later chunks skip worker
 *   dispatch entirely.
 * - The failure log is emitted once per file via `workerTokenizeFailed` while
 *   preserving token output by retrying on the main thread for that chunk.
 *
 * @param {{
 *   effectiveTokenizeEnabled:boolean,
 *   runTokenize:((payload:any)=>Promise<any>)|null,
 *   workerState:any,
 *   log:(line:string)=>void,
 *   crashLogger:any,
 *   relKey:string,
 *   fileSize:number|null|undefined,
 *   fileLanguageId:string|null|undefined,
 *   lang:any,
 *   workerDictOverride:any,
 *   parserMode:string,
 *   parserReasonCode:string|null,
 *   addTokenizeDuration:(ms:number)=>void,
 *   addSettingMetric:(name:string,languageId:string,lineCount:number,durationMs:number)=>void,
 *   updateCrashStage:(substage:string,extra?:object)=>void,
 *   dictConfig:any,
 *   fileTokenContext:any,
 *   tokenBuffers:any
 * }} options
 * @returns {(input:{
 *   chunkIndex:number,
 *   chunkMode:string,
 *   chunkLanguageId:string|null,
 *   tokenText:string,
 *   effectiveExt:string|null,
 *   pretokenized:any,
 *   chunkLineCount:number,
 *   dictWordsForChunk:any
 * })=>Promise<any>}
 */
export const createChunkTokenizer = ({
  effectiveTokenizeEnabled,
  runTokenize,
  workerState,
  log,
  crashLogger,
  relKey,
  fileSize,
  fileLanguageId,
  lang,
  workerDictOverride,
  parserMode,
  parserReasonCode,
  addTokenizeDuration,
  addSettingMetric,
  updateCrashStage,
  dictConfig,
  fileTokenContext,
  tokenBuffers
}) => {
  let allowWorkerTokenize = typeof runTokenize === 'function'
    && workerState?.tokenWorkerDisabled !== true;

  return async ({
    chunkIndex,
    chunkMode,
    chunkLanguageId,
    tokenText,
    effectiveExt,
    pretokenized,
    chunkLineCount,
    dictWordsForChunk
  }) => {
    let tokenPayload = null;
    let usedWorkerTokenize = false;

    if (effectiveTokenizeEnabled && allowWorkerTokenize && !pretokenized) {
      try {
        const tokenStart = Date.now();
        updateCrashStage('tokenize-worker', {
          chunkIndex,
          chunkMode,
          chunkLanguageId: chunkLanguageId || null,
          parserMode,
          parserReasonCode
        });
        tokenPayload = await runTokenize({
          text: tokenText,
          mode: chunkMode,
          ext: effectiveExt,
          languageId: chunkLanguageId,
          file: relKey,
          size: fileSize,
          // chargramTokens is intentionally omitted by token-flow hot path.
          ...(workerDictOverride ? { dictConfig: workerDictOverride } : {})
        });
        updateCrashStage('tokenize-worker:done', {
          chunkIndex,
          chunkMode,
          chunkLanguageId: chunkLanguageId || null,
          parserMode,
          parserReasonCode,
          hasPayload: Boolean(tokenPayload),
          tokenCount: Array.isArray(tokenPayload?.tokens) ? tokenPayload.tokens.length : 0
        });
        const tokenDurationMs = Date.now() - tokenStart;
        addTokenizeDuration(tokenDurationMs);
        if (tokenPayload) {
          usedWorkerTokenize = true;
          addSettingMetric('tokenize', chunkLanguageId, chunkLineCount, tokenDurationMs);
        }
      } catch (err) {
        if (workerState?.workerTokenizeFailed !== true) {
          const message = formatError(err);
          const detail = err?.stack || err?.cause || null;
          log(`Worker tokenization failed; falling back to main thread. ${message}`);
          if (detail) log(`Worker tokenization detail: ${detail}`);
          if (workerState && typeof workerState === 'object') {
            workerState.workerTokenizeFailed = true;
          }
        }
        if (workerState && typeof workerState === 'object') {
          workerState.tokenWorkerDisabled = true;
        }
        allowWorkerTokenize = false;
        if (crashLogger?.enabled) {
          crashLogger.logError({
            phase: 'worker-tokenize',
            file: relKey,
            size: fileSize || null,
            languageId: fileLanguageId || lang?.id || null,
            message: formatError(err),
            stack: err?.stack || null,
            raw: util.inspect(err, {
              depth: 5,
              breakLength: 120,
              showHidden: true,
              getters: true
            }),
            ownProps: err && typeof err === 'object'
              ? Object.getOwnPropertyNames(err)
              : [],
            ownSymbols: err && typeof err === 'object'
              ? Object.getOwnPropertySymbols(err).map((sym) => sym.toString())
              : []
          });
        }
      }
    }

    if (effectiveTokenizeEnabled && !tokenPayload) {
      const tokenStart = Date.now();
      updateCrashStage('tokenize', {
        chunkIndex,
        chunkMode,
        chunkLanguageId: chunkLanguageId || null,
        parserMode,
        parserReasonCode
      });
      tokenPayload = tokenizeChunkText({
        text: tokenText,
        mode: chunkMode,
        ext: effectiveExt,
        context: fileTokenContext,
        languageId: chunkLanguageId,
        pretokenized,
        // chargramTokens is intentionally omitted (see token-flow worker path note).
        buffers: tokenBuffers
      });
      const tokenDurationMs = Date.now() - tokenStart;
      addTokenizeDuration(tokenDurationMs);
      addSettingMetric('tokenize', chunkLanguageId, chunkLineCount, tokenDurationMs);
    }

    if (!effectiveTokenizeEnabled) {
      tokenPayload = createDisabledTokenPayload();
    }

    const tokenClassificationEnabled = effectiveTokenizeEnabled
      && fileTokenContext?.tokenClassification?.enabled === true
      && chunkMode === 'code';
    if (tokenClassificationEnabled && usedWorkerTokenize) {
      // Worker tokenization intentionally skips tree-sitter classification to avoid
      // parser/runtime multiplication across --threads. Reattach on main thread.
      const tokenList = Array.isArray(tokenPayload.tokens) ? tokenPayload.tokens : [];
      const tokenClassificationRuntime = fileTokenContext?.tokenClassificationRuntime;
      updateCrashStage('token-classification:start', {
        chunkIndex,
        chunkMode,
        chunkLanguageId: chunkLanguageId || null,
        parserMode,
        parserReasonCode,
        tokenCount: tokenList.length,
        treeSitterEnabled: tokenClassificationRuntime?.treeSitterEnabled !== false,
        remainingChunks: Number.isFinite(tokenClassificationRuntime?.remainingChunks)
          ? tokenClassificationRuntime.remainingChunks
          : null,
        remainingBytes: Number.isFinite(tokenClassificationRuntime?.remainingBytes)
          ? tokenClassificationRuntime.remainingBytes
          : null
      });
      try {
        const classification = classifyTokenBuckets({
          text: tokenText,
          tokens: tokenList,
          languageId: chunkLanguageId,
          ext: effectiveExt,
          dictWords: dictWordsForChunk,
          dictConfig,
          context: fileTokenContext
        });
        updateCrashStage('token-classification:done', {
          chunkIndex,
          chunkMode,
          chunkLanguageId: chunkLanguageId || null,
          parserMode,
          parserReasonCode,
          identifierCount: Array.isArray(classification?.identifierTokens)
            ? classification.identifierTokens.length
            : 0,
          keywordCount: Array.isArray(classification?.keywordTokens)
            ? classification.keywordTokens.length
            : 0,
          operatorCount: Array.isArray(classification?.operatorTokens)
            ? classification.operatorTokens.length
            : 0,
          literalCount: Array.isArray(classification?.literalTokens)
            ? classification.literalTokens.length
            : 0
        });
        applyTokenClassification(tokenPayload, classification);
      } catch (err) {
        updateCrashStage('token-classification:error', {
          chunkIndex,
          chunkMode,
          chunkLanguageId: chunkLanguageId || null,
          parserMode,
          parserReasonCode,
          errorName: err?.name || null,
          errorCode: err?.code || null
        });
        throw err;
      }
    }

    return tokenPayload;
  };
};
