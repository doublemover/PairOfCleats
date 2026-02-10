import { buildSearchRequestArgs } from '../../shared/search-request.js';

export const buildSearchParams = (_repoPath, payload, defaultOutput) => {
  const result = buildSearchRequestArgs(payload, {
    defaultOutput,
    allowedOutputs: ['compact', 'json', 'full'],
    includeRepo: false,
    topFlag: '--top',
    topMin: 0,
    omitModeBoth: false
  });
  if (!result.ok) {
    return { ok: false, message: result.message || 'Invalid search payload.' };
  }
  return {
    ok: true,
    args: result.args,
    query: result.query
  };
};

export const isNoIndexError = (err) => {
  if (!err) return false;
  if (err.code === 'ERR_INDEX_NOT_FOUND') return true;
  const message = String(err.message || '').toLowerCase();
  return message.includes('index not found') || message.includes('build index');
};
