import path from 'node:path';
import { getCodeDictionaryPaths, getDictionaryPaths, getDictConfig } from '../../../shared/dict-utils.js';
import {
  collectDictionaryFileSignatures,
  loadCodeDictionaryWordSets,
  loadDictionaryWordSetFromFiles
} from '../../../shared/dictionary-wordlists.js';
import { createSharedDictionary, createSharedDictionaryView } from '../../../shared/dictionary.js';
import { sha1 } from '../../../shared/hash.js';
import { DEFAULT_CODE_DICT_LANGUAGES, normalizeCodeDictLanguages } from '../../../shared/code-dictionaries.js';
import { normalizeDictSignaturePath } from './normalize.js';
import { getDaemonDictionaryCacheEntry, setDaemonDictionaryCacheEntry } from './daemon-session.js';

const LARGE_DICT_SHARED_THRESHOLD = 200000;

/**
 * Narrow values to plain object records (excluding arrays).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Clone set values while tolerating nullish/non-set inputs.
 *
 * @param {Set<unknown>|unknown} source
 * @returns {Set<unknown>}
 */
const cloneSet = (source) => new Set(source instanceof Set ? source : []);

/**
 * Clone `Map<K, Set<V>>` style dictionary payloads.
 *
 * @param {Map<unknown, Set<unknown>>|unknown} source
 * @returns {Map<unknown, Set<unknown>>}
 */
const cloneMapOfSets = (source) => {
  if (!(source instanceof Map)) return new Map();
  return new Map(
    Array.from(source.entries()).map(([key, value]) => [key, cloneSet(value)])
  );
};

/**
 * Clone shared dictionary payload metadata while retaining underlying
 * SharedArrayBuffer references.
 *
 * @param {object|null|undefined} payload
 * @returns {object|null}
 */
export const cloneSharedDictionaryPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  if (!payload.bytes || !payload.offsets) return null;
  const cloned = {
    bytes: payload.bytes,
    offsets: payload.offsets
  };
  if (Number.isFinite(payload.count)) {
    cloned.count = Math.max(0, Math.floor(payload.count));
  }
  if (Number.isFinite(payload.maxLen)) {
    cloned.maxLen = Math.max(0, Math.floor(payload.maxLen));
  }
  return cloned;
};

/**
 * Clone dictionary summary objects from daemon warm cache entries.
 *
 * @param {unknown} summary
 * @returns {object|null}
 */
const cloneDictSummary = (summary) => {
  if (!isObject(summary)) return null;
  const code = isObject(summary.code)
    ? {
      files: Number.isFinite(summary.code.files) ? Math.max(0, Math.floor(summary.code.files)) : 0,
      words: Number.isFinite(summary.code.words) ? Math.max(0, Math.floor(summary.code.words)) : 0,
      languages: Array.isArray(summary.code.languages)
        ? summary.code.languages.map((entry) => String(entry)).sort()
        : [],
      bundleProfileVersion: typeof summary.code.bundleProfileVersion === 'string'
        ? summary.code.bundleProfileVersion
        : null
    }
    : {
      files: 0,
      words: 0,
      languages: [],
      bundleProfileVersion: null
    };
  return {
    files: Number.isFinite(summary.files) ? Math.max(0, Math.floor(summary.files)) : 0,
    words: Number.isFinite(summary.words) ? Math.max(0, Math.floor(summary.words)) : 0,
    code
  };
};

/**
 * Deep-clone daemon dictionary cache entries before attaching to runtime state.
 *
 * @param {object|null|undefined} entry
 * @returns {object|null}
 */
const cloneDaemonDictionaryEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  return {
    dictWords: cloneSet(entry.dictWords),
    codeDictCommonWords: cloneSet(entry.codeDictCommonWords),
    codeDictWordsAll: cloneSet(entry.codeDictWordsAll),
    codeDictWordsByLanguage: cloneMapOfSets(entry.codeDictWordsByLanguage),
    dictSharedPayload: cloneSharedDictionaryPayload(entry.dictSharedPayload),
    dictSummary: cloneDictSummary(entry.dictSummary)
  };
};

/**
 * Build deterministic dictionary signatures while memoizing normalized path
 * conversion to reduce duplicate relative-path normalization work.
 *
 * @param {{dictDir:string|null,repoRoot:string}} input
 * @returns {(dictFile:string) => string}
 */
const createDictSignaturePathResolver = ({ dictDir, repoRoot }) => {
  const cache = new Map();
  return (dictFile) => {
    const key = String(dictFile || '');
    const cached = cache.get(key);
    if (cached) return cached;
    const normalized = normalizeDictSignaturePath({ dictFile, dictDir, repoRoot });
    cache.set(key, normalized);
    return normalized;
  };
};

/**
 * Return empty code-dictionary wordset containers.
 *
 * @returns {{commonWords:Set<string>,wordsByLanguage:Map<string, Set<string>>,allWords:Set<string>}}
 */
const createEmptyCodeDictWordSets = () => ({
  commonWords: new Set(),
  wordsByLanguage: new Map(),
  allWords: new Set()
});

/**
 * Build runtime dictionary telemetry summary.
 *
 * @param {{
 *   dictionaryPaths:string[],
 *   codeDictPaths:{all:string[],bundleProfileVersion?:string},
 *   dictWords:Set<string>,
 *   codeDictWordsAll:Set<string>,
 *   codeDictWordsByLanguage:Map<string, Set<string>>
 * }} input
 * @returns {{
 *   files:number,
 *   words:number,
 *   code:{files:number,words:number,languages:string[],bundleProfileVersion:string|null}
 * }}
 */
const buildDictSummary = ({
  dictionaryPaths,
  codeDictPaths,
  dictWords,
  codeDictWordsAll,
  codeDictWordsByLanguage
}) => ({
  files: dictionaryPaths.length,
  words: dictWords.size,
  code: {
    files: codeDictPaths.all.length,
    words: codeDictWordsAll.size,
    languages: Array.from(codeDictWordsByLanguage.keys()).sort(),
    bundleProfileVersion: typeof codeDictPaths?.bundleProfileVersion === 'string'
      ? codeDictPaths.bundleProfileVersion
      : null
  }
});

/**
 * Load dictionary/configuration artifacts for runtime construction with daemon
 * warm-cache support.
 *
 * @param {{
 *   root:string,
 *   userConfig:object,
 *   workerPoolConfig:object,
 *   daemonSession:object|null,
 *   log:(line:string)=>void,
 *   logInit:(label:string,startedAt:number)=>void
 * }} input
 * @returns {Promise<{
 *   dictConfig:object,
 *   dictionaryPaths:string[],
 *   codeDictPaths:{baseDir:string,common:string[],byLanguage:Map<string,string[]>,all:string[]},
 *   dictWords:Set<string>,
 *   codeDictCommonWords:Set<string>,
 *   codeDictWordsByLanguage:Map<string, Set<string>>,
 *   codeDictWordsAll:Set<string>,
 *   dictSummary:{
 *     files:number,
 *     words:number,
 *     code:{files:number,words:number,languages:string[],bundleProfileVersion:string|null}
 *   },
 *   dictSignature:string|null,
 *   dictSharedPayload:object|null,
 *   dictShared:object|null,
 *   codeDictLanguages:Set<string>
 * }>}
 */
export const resolveRuntimeDictionaries = async ({
  root,
  userConfig,
  workerPoolConfig,
  daemonSession,
  log,
  logInit
}) => {
  const dictStartedAt = Date.now();
  const dictConfig = getDictConfig(root, userConfig);
  const dictDir = dictConfig?.dir || null;
  const requestedCodeDictLanguages = normalizeCodeDictLanguages(
    userConfig?.indexing?.codeDictLanguages ?? DEFAULT_CODE_DICT_LANGUAGES
  );
  const codeDictEnabled = requestedCodeDictLanguages.size > 0;
  const emptyCodeDictPaths = {
    baseDir: path.join(dictDir || '', 'code-dicts'),
    common: [],
    byLanguage: new Map(),
    all: []
  };

  const [dictionaryPaths, codeDictPaths] = await Promise.all([
    getDictionaryPaths(root, dictConfig),
    codeDictEnabled
      ? getCodeDictionaryPaths(root, dictConfig, { languages: Array.from(requestedCodeDictLanguages) })
      : Promise.resolve(emptyCodeDictPaths)
  ]);
  const codeDictLanguages = normalizeCodeDictLanguages(Array.from(codeDictPaths.byLanguage.keys()));

  const toDictSignaturePath = createDictSignaturePathResolver({ dictDir, repoRoot: root });
  const [baseSignatures, codeSignatures] = await Promise.all([
    collectDictionaryFileSignatures(dictionaryPaths, { toSignaturePath: toDictSignaturePath }),
    collectDictionaryFileSignatures(codeDictPaths.all, {
      toSignaturePath: toDictSignaturePath,
      prefix: 'code:'
    })
  ]);
  const dictSignatureParts = baseSignatures.concat(codeSignatures);
  dictSignatureParts.sort();
  const dictSignature = dictSignatureParts.length
    ? sha1(dictSignatureParts.join('|'))
    : null;

  const cachedDaemonDict = cloneDaemonDictionaryEntry(
    daemonSession && dictSignature
      ? getDaemonDictionaryCacheEntry(daemonSession, dictSignature)
      : null
  );
  let dictWords = cachedDaemonDict?.dictWords || new Set();
  let codeDictCommonWords = cachedDaemonDict?.codeDictCommonWords || new Set();
  let codeDictWordsByLanguage = cachedDaemonDict?.codeDictWordsByLanguage || new Map();
  let codeDictWordsAll = cachedDaemonDict?.codeDictWordsAll || new Set();
  const daemonDictCacheHit = Boolean(cachedDaemonDict);

  if (!daemonDictCacheHit) {
    const [, codeDictWordSets] = await Promise.all([
      loadDictionaryWordSetFromFiles(dictionaryPaths, { target: dictWords }),
      codeDictEnabled
        ? loadCodeDictionaryWordSets({
          commonFiles: codeDictPaths.common,
          byLanguage: codeDictPaths.byLanguage,
          lowerCase: true
        })
        : Promise.resolve(createEmptyCodeDictWordSets())
    ]);
    codeDictCommonWords = codeDictWordSets.commonWords;
    codeDictWordsByLanguage = codeDictWordSets.wordsByLanguage;
    codeDictWordsAll = codeDictWordSets.allWords;
  } else {
    log('[init] dictionaries loaded from daemon warm cache.');
  }

  const dictSummary = buildDictSummary({
    dictionaryPaths,
    codeDictPaths,
    dictWords,
    codeDictWordsAll,
    codeDictWordsByLanguage
  });

  const shouldShareDict = dictSummary.words
    && (workerPoolConfig.enabled !== false || dictSummary.words >= LARGE_DICT_SHARED_THRESHOLD);
  const dictSharedPayload = shouldShareDict
    ? (
      cloneSharedDictionaryPayload(cachedDaemonDict?.dictSharedPayload)
      || createSharedDictionary(dictWords)
    )
    : null;
  const dictShared = dictSharedPayload ? createSharedDictionaryView(dictSharedPayload) : null;

  if (daemonSession && dictSignature && !daemonDictCacheHit) {
    setDaemonDictionaryCacheEntry(daemonSession, dictSignature, {
      dictWords,
      codeDictCommonWords,
      codeDictWordsAll,
      codeDictWordsByLanguage,
      dictSharedPayload,
      dictSummary
    });
  }
  logInit('dictionaries', dictStartedAt);

  return {
    dictConfig,
    dictionaryPaths,
    codeDictPaths,
    dictWords,
    codeDictCommonWords,
    codeDictWordsByLanguage,
    codeDictWordsAll,
    dictSummary,
    dictSignature,
    dictSharedPayload,
    dictShared,
    codeDictLanguages
  };
};
