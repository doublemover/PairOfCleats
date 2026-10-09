import { splitWordsWithDict } from '../../shared/tokenize.js';
import { digest } from './common.js';

export const ARCHIVE_ANALYZER_VERSION = 'archive-lexical.v2';
const segmenter = new Intl.Segmenter('und', { granularity: 'word' });
const normalize = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
export const archiveLiteralWords = text => normalize(text).match(/[\p{L}\p{N}_]+/gu) ?? [];

/** Full identifiers remain primary terms; acronym/Unicode boundaries only add aliases. */
export function createArchiveLexicalAnalyzer(vocabulary = null) {
  const words = vocabulary?.words ?? new Set();
  const identity = digest(JSON.stringify([ARCHIVE_ANALYZER_VERSION, process.versions.icu, vocabulary?.receipt?.signature ?? null]));
  const terms = text => {
    const result = new Set(archiveLiteralWords(text));
    for (const raw of String(text ?? '').normalize('NFKC').match(/[\p{L}\p{M}\p{N}_]+/gu) ?? []) {
      const parts = raw.replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
        .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').split(/_+|\s+/u);
      for (const part of parts) {
        const word = normalize(part);
        if (word) result.add(word);
        if (word.length <= 256) for (const alias of splitWordsWithDict(word, words)) if (alias) result.add(alias);
        for (const segment of segmenter.segment(part)) if (segment.isWordLike) result.add(normalize(segment.segment));
      }
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
