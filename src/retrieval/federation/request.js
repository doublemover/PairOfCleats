import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { parseSearchArgs, hasSearchFilterArgs } from '../cli-args.js';
import { buildPerRepoArgsFromRequest } from './args.js';

export const resolveFederatedCursor = request => {
  const outer = request.cursor;
  const inner = request.search?.cursor;
  for (const cursor of [outer, inner]) {
    if (cursor != null && (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,16384}$/.test(cursor))) {
      throw createError(ERROR_CODES.INVALID_REQUEST, 'Invalid workspace cursor. Restart without --cursor.');
    }
  }
  if (outer != null && inner != null && outer !== inner) {
    throw createError(ERROR_CODES.INVALID_REQUEST, 'cursor and search.cursor must identify the same workspace page.');
  }
  const cursor = outer ?? inner ?? null;
  if (String(request.query || '').trim() && cursor !== null) {
    throw createError(ERROR_CODES.INVALID_REQUEST, 'Workspace cursors require filter-only enumeration.');
  }
  return cursor;
};

/** HTTP performs the same effective query/filter check before workspace I/O. */
export const validateFederatedSearchAdmission = request => {
  try {
    resolveFederatedCursor(request);
    const query = String(request.query || '').trim();
    const args = buildPerRepoArgsFromRequest({ query, search: { ...request.search, cursor: null }, perRepoTop: 1 });
    if (!query && !hasSearchFilterArgs(parseSearchArgs(args))) {
      throw createError(ERROR_CODES.INVALID_REQUEST, 'Provide query text or at least one search filter.');
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, errors: [error?.message || String(error)] };
  }
};
