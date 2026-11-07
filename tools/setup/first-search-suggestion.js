import { loadChunkMetaRows } from '../../src/shared/artifact-io/loaders/chunk-meta.js';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../shared/dict-utils.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';

/** Optional bounded read after validation; never a search or inference receipt. */
export const resolveFirstSearchSuggestion = async ({ repoRoot, signal = null }) => {
  signal?.throwIfAborted();
  try {
    const config = loadUserConfig(repoRoot);
    const current = getCurrentBuildInfo(repoRoot, config, { mode: 'code' });
    const indexDir = getIndexDir(repoRoot, 'code', config);
    let examined = 0;
    for await (const row of loadChunkMetaRows(indexDir, { maxBytes: 1024 * 1024,
      includeCold: false, enforceBinaryDataBudget: true })) {
      signal?.throwIfAborted();
      if (typeof row?.name === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]{1,95}$/.test(row.name)) {
        return { state: 'indexed-symbol', query: row.name, source: { indexDir, buildId: current?.buildId || null,
          file: typeof row.file === 'string' ? row.file : null }, verification: 'indexed-name-inventory-only' };
      }
      if (++examined >= 64) break;
    }
    return { state: 'query-required', query: null, reason: 'No supported identifier was found in the bounded indexed-name sample.' };
  } catch (error) {
    if (signal?.aborted) throw error;
    const failure = describeStorageFailure(error, { phase: 'first-search-query-inventory' });
    return { state: 'query-required', query: null, reason: 'The optional bounded indexed-name sample is unavailable.', code: failure.code };
  }
};
