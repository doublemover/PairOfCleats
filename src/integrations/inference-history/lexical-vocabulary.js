import fs from 'node:fs/promises';
import path from 'node:path';
import { addDictionaryWordsFromText } from '../../shared/dictionary-wordlists.js';
import { archiveLiteralWords, createArchiveLexicalAnalyzer } from './lexical-analyzer.js';
import { ARCHIVE_ASSET_POLICY_VERSION, sanitizeEmbeddedAssetText } from './embedded-assets.js';
import { hasHiddenTraceMarker, sanitizeArtifactJson } from './artifact-projection.js';
import { digest, historyError, redactHistoryText } from './common.js';

/** No default/config/home discovery: every dictionary file is explicitly selected. */
export async function loadArchiveVocabulary(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !['customFiles', 'repoFiles', 'commonFiles', 'byLanguage'].includes(key))) {
    throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Explicit archive dictionary selections required.');
  }
  const selections = [];
  const add = (files = [], kind, language = null) => {
    if (!Array.isArray(files) || files.some(file => typeof file !== 'string' || !path.isAbsolute(file))) {
      throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Archive dictionary paths must be absolute selections.');
    }
    for (const file of files) selections.push({ path: path.resolve(file), kind, language });
  };
  add(options.customFiles, 'custom'); add(options.repoFiles, 'repo'); add(options.commonFiles, 'common');
  if (options.byLanguage && (typeof options.byLanguage !== 'object' || Array.isArray(options.byLanguage))) {
    throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Archive language dictionary selections required.');
  }
  for (const [language, files] of Object.entries(options.byLanguage ?? {}).sort()) add(files, 'language', language);
  const words = new Set(), files = [];
  for (const selection of selections) {
    try {
      const stat = await fs.lstat(selection.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('invalid dictionary file');
      const bytes = await fs.readFile(selection.path);
      if (bytes.length > 16 * 1024 * 1024) throw new Error('invalid dictionary file');
      const loaded = addDictionaryWordsFromText(bytes.toString('utf8'), new Set(), { lowerCase: true });
      const normalized = new Set([...loaded].flatMap(archiveLiteralWords));
      for (const word of normalized) words.add(word);
      files.push({ ...selection, state: 'loaded', bytes: bytes.length, sha256: digest(bytes), wordCount: normalized.size });
    } catch (error) { files.push({ ...selection, state: 'unavailable', reason: error.code ?? 'invalid_file', wordCount: 0 }); }
  }
  const receipt = { version: 'archive-vocabulary.v1', files,
    languages: [...new Set(files.filter(file => file.state === 'loaded' && file.language).map(file => file.language))].sort(),
    wordCount: words.size, signature: digest(JSON.stringify(files)) };
  return { words, receipt };
}

const MAX_VOCABULARY_JSON_CHARS = 16 * 1024 * 1024;
function assertAssetFreeVocabularyText(text) {
  if (sanitizeEmbeddedAssetText(text) !== text) throw new TypeError('Vocabulary input must omit embedded asset payloads.');
  if (!/^\s*[\[{]/.test(text)) return;
  if (text.length > MAX_VOCABULARY_JSON_CHARS) throw new TypeError('Vocabulary JSON requires bounded sanitized content.');
  let value;
  try { value = JSON.parse(text); } catch { return; /* Code/prose is never wrapped or executed as JSON. */ }
  if (JSON.stringify(sanitizeArtifactJson(value)) !== JSON.stringify(value)) {
    throw new TypeError('Vocabulary JSON must satisfy archive artifact sanitization policy.');
  }
}

/** Caller supplies sanitized recovered content, never serialized transport records. */
export function extractArchiveVocabulary(sources, { minCount = 3 } = {}) {
  if (!Number.isSafeInteger(minCount) || minCount < 1) throw new TypeError('Positive vocabulary minimum required.');
  const counts = new Map(), languages = new Set(), content = [];
  const analyzer = createArchiveLexicalAnalyzer();
  for (const source of sources) {
    if (typeof source?.sanitizedText !== 'string') throw new TypeError('Recovered sanitizedText required.');
    if (hasHiddenTraceMarker(source.sanitizedText) || redactHistoryText(source.sanitizedText) !== source.sanitizedText) {
      throw new TypeError('Vocabulary input must satisfy archive trace omission and credential redaction policy.');
    }
    assertAssetFreeVocabularyText(source.sanitizedText);
    if (source.language) languages.add(source.language);
    content.push([source.sourceSha256 ?? null, digest(source.sanitizedText), source.language ?? null]);
    for (const raw of source.sanitizedText.match(/[\p{L}\p{M}\p{N}_]+/gu) ?? []) {
      for (const word of analyzer.terms(raw)) if (word.length >= 3) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const entries = [...counts].filter(([, count]) => count >= minCount).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { words: entries.map(([word]) => word), counts: entries, sourceCount: content.length,
    languages: [...languages].sort(), assetPolicyVersion: ARCHIVE_ASSET_POLICY_VERSION, contentSignature: digest(JSON.stringify([ARCHIVE_ASSET_POLICY_VERSION, content])) };
}
