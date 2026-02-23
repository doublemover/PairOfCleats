import { getDaemonTreeSitterCacheEntry, setDaemonTreeSitterCacheEntry } from './daemon-session.js';
import { preloadTreeSitterRuntimeLanguages } from './tree-sitter.js';

/**
 * Normalize language ids for stable preload cache keys.
 *
 * @param {unknown} languages
 * @returns {string[]}
 */
const normalizeLanguagesForCacheKey = (languages) => {
  if (!Array.isArray(languages)) return [];
  const values = [];
  for (const entry of languages) {
    if (typeof entry !== 'string') continue;
    const token = entry.trim();
    if (!token) continue;
    values.push(token);
  }
  values.sort();
  return values;
};

/**
 * Build a deterministic daemon preload cache key.
 *
 * @param {{
 *   treeSitterLanguages:unknown,
 *   treeSitterPreload:unknown,
 *   treeSitterPreloadConcurrency:unknown
 * }} input
 * @returns {string}
 */
const buildPreloadCacheKey = ({
  treeSitterLanguages,
  treeSitterPreload,
  treeSitterPreloadConcurrency
}) => {
  const languages = normalizeLanguagesForCacheKey(treeSitterLanguages);
  const preloadEnabled = treeSitterPreload !== false ? '1' : '0';
  const concurrency = Number.isFinite(Number(treeSitterPreloadConcurrency))
    ? Math.max(0, Math.floor(Number(treeSitterPreloadConcurrency)))
    : 0;
  return `languages=${languages.join(',')};preload=${preloadEnabled};concurrency=${concurrency}`;
};

/**
 * Preload tree-sitter runtime languages with daemon-session cache reuse.
 *
 * @param {{
 *   daemonSession:object|null,
 *   treeSitterEnabled:boolean,
 *   treeSitterLanguages:unknown,
 *   treeSitterPreload:unknown,
 *   treeSitterPreloadConcurrency:unknown,
 *   log:(line:string)=>void,
 *   logInit:(label:string,startedAt:number)=>void
 * }} input
 * @returns {Promise<void>}
 */
export const preloadTreeSitterWithDaemonCache = async ({
  daemonSession,
  treeSitterEnabled,
  treeSitterLanguages,
  treeSitterPreload,
  treeSitterPreloadConcurrency,
  log,
  logInit
}) => {
  if (!treeSitterEnabled) {
    log('Tree-sitter chunking disabled via indexing.treeSitter.enabled.');
    return;
  }
  const preloadCacheKey = buildPreloadCacheKey({
    treeSitterLanguages,
    treeSitterPreload,
    treeSitterPreloadConcurrency
  });
  const cachedPreloadCount = Number(getDaemonTreeSitterCacheEntry(daemonSession, preloadCacheKey));
  if (Number.isFinite(cachedPreloadCount) && cachedPreloadCount >= 0) {
    if (cachedPreloadCount > 0) {
      log(`[init] tree-sitter preload warm hit (${cachedPreloadCount} languages).`);
    }
    return;
  }
  const preloadStart = Date.now();
  const preloadCount = await preloadTreeSitterRuntimeLanguages({
    treeSitterEnabled,
    treeSitterLanguages,
    treeSitterPreload,
    treeSitterPreloadConcurrency,
    observedLanguages: null,
    log
  });
  setDaemonTreeSitterCacheEntry(daemonSession, preloadCacheKey, preloadCount);
  if (preloadCount > 0) {
    logInit('tree-sitter preload', preloadStart);
  }
};
