import { dictionaryIdentifierTerms, DICTIONARY_IDENTIFIER_VERSION } from '../../shared/dictionary-identifiers.js';
import { splitWordsWithDict } from '../../shared/tokenize.js';
import { digest } from './common.js';

export const ARCHIVE_ANALYZER_VERSION = 'archive-lexical.v3';
const normalize = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
export const archiveLiteralWords = text => normalize(text).match(/[\p{L}\p{N}_]+/gu) ?? [];

/** Full identifiers remain primary terms; acronym/Unicode boundaries only add aliases. */
export function createArchiveLexicalAnalyzer(vocabulary = null) {
  const words = vocabulary?.words ?? new Set();
  const identity = digest(JSON.stringify([ARCHIVE_ANALYZER_VERSION, DICTIONARY_IDENTIFIER_VERSION, process.versions.icu, vocabulary?.receipt?.signature ?? null]));
  const terms = text => {
    const result = new Set(archiveLiteralWords(text));
    for (const word of dictionaryIdentifierTerms(text)) {
      result.add(word);
      if (word.length <= 256) for (const alias of splitWordsWithDict(word, words)) if (alias) result.add(alias);
    }
    return [...result];
  };
  return Object.freeze({ identity, version: ARCHIVE_ANALYZER_VERSION, terms,
    indexText: text => [...archiveLiteralWords(text), ...terms(text)].join(' '),
    receipt: vocabulary?.receipt ?? { version: ARCHIVE_ANALYZER_VERSION, files: [], languages: [], wordCount: 0, signature: null } });
}
export const DEFAULT_ARCHIVE_ANALYZER = createArchiveLexicalAnalyzer();
const analyzers = new WeakMap();
export const archiveAnalyzerFor = db => analyzers.get(db) ?? DEFAULT_ARCHIVE_ANALYZER;
export function registerArchiveAnalyzer(db, analyzer = DEFAULT_ARCHIVE_ANALYZER) {
  analyzers.set(db, analyzer);
  db.function('history_lexical_text', { deterministic: true }, text => analyzer.indexText(text));
  return analyzer;
}
