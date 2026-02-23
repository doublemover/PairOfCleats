import { normalizeDocMeta } from '../../meta.js';

const resolveSqlDialectForChunk = ({
  languageOptions,
  effectiveExt,
  containerExt
}) => {
  const resolveSqlDialect = typeof languageOptions?.resolveSqlDialect === 'function'
    ? languageOptions.resolveSqlDialect
    : null;
  const resolvedSqlDialect = resolveSqlDialect
    ? resolveSqlDialect(effectiveExt || containerExt || '')
    : (languageOptions?.sql?.dialect || 'generic');
  if (typeof resolvedSqlDialect === 'string' && resolvedSqlDialect.trim()) {
    return resolvedSqlDialect.trim().toLowerCase();
  }
  return 'generic';
};

/**
 * Normalize chunk docmeta and merge parser fallback metadata.
 *
 * Invariant: returned metadata always carries deterministic parser mode/reason
 * so downstream consumers can treat fallback signaling as required contract.
 *
 * @param {{
 *   docmeta:any,
 *   chunkMode:string,
 *   chunkLanguageId:string|null,
 *   languageOptions:any,
 *   effectiveExt:string|null,
 *   containerExt:string|null,
 *   parserMode:string,
 *   parserReasonCode:string|null,
 *   parserReason:string|null
 * }} input
 * @returns {object}
 */
export const normalizeChunkDocmeta = ({
  docmeta,
  chunkMode,
  chunkLanguageId,
  languageOptions,
  effectiveExt,
  containerExt,
  parserMode,
  parserReasonCode,
  parserReason
}) => {
  let normalizedDocmeta = normalizeDocMeta(docmeta);
  if (
    chunkMode === 'code'
    && chunkLanguageId === 'sql'
    && (!normalizedDocmeta?.dialect || typeof normalizedDocmeta.dialect !== 'string')
  ) {
    // Scheduler/fallback chunk paths can skip SQL dialect propagation from
    // language prepare context; enforce deterministic dialect metadata here.
    normalizedDocmeta = {
      ...normalizedDocmeta,
      dialect: resolveSqlDialectForChunk({
        languageOptions,
        effectiveExt,
        containerExt
      })
    };
  }
  return {
    ...normalizedDocmeta,
    parser: {
      ...(normalizedDocmeta?.parser && typeof normalizedDocmeta.parser === 'object'
        ? normalizedDocmeta.parser
        : {}),
      mode: parserMode,
      fallbackMode: parserMode,
      reasonCode: parserReasonCode,
      reason: parserReason,
      deterministic: true
    }
  };
};
