import { TREE_SITTER_LANGUAGE_IDS } from '../../../lang/tree-sitter/config.js';
import { isTreeSitterEnabled } from '../../../lang/tree-sitter/options.js';
import { resolveSegmentExt } from '../../segments/config.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);

const resolveTreeSitterLanguageForExt = (languageId, ext) => {
  const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
  if (normalizedExt === '.tsx') return 'tsx';
  if (normalizedExt === '.jsx') return 'jsx';
  if (normalizedExt === '.ts' || normalizedExt === '.cts' || normalizedExt === '.mts') return 'typescript';
  if (normalizedExt === '.js' || normalizedExt === '.mjs' || normalizedExt === '.cjs' || normalizedExt === '.jsm') {
    return 'javascript';
  }
  if (normalizedExt === '.py') return 'python';
  if (normalizedExt === '.json') return 'json';
  if (normalizedExt === '.yaml' || normalizedExt === '.yml') return 'yaml';
  if (normalizedExt === '.toml') return 'toml';
  if (normalizedExt === '.xml') return 'xml';
  if (normalizedExt === '.md' || normalizedExt === '.mdx') return 'markdown';
  if (!normalizedExt) return languageId;
  if (normalizedExt === '.m' || normalizedExt === '.mm') return 'objc';
  if (normalizedExt === '.cpp' || normalizedExt === '.cc' || normalizedExt === '.cxx'
    || normalizedExt === '.hpp' || normalizedExt === '.hh' || normalizedExt === '.hxx') return 'cpp';
  if (normalizedExt === '.c' || normalizedExt === '.h') return 'clike';
  return languageId;
};

const resolveTreeSitterLanguageForSegment = (languageId, ext) => {
  const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
  if (languageId === 'typescript' && normalizedExt === '.tsx') return 'tsx';
  if (languageId === 'javascript' && normalizedExt === '.jsx') return 'jsx';
  if (languageId === 'clike' || languageId === 'objc' || languageId === 'cpp') {
    return resolveTreeSitterLanguageForExt(languageId, ext);
  }
  if (languageId) return languageId;
  return resolveTreeSitterLanguageForExt(languageId, ext);
};

const resolveTreeSitterLanguagesForSegments = ({ segments, primaryLanguageId, ext, treeSitterConfig }) => {
  if (!treeSitterConfig || treeSitterConfig.enabled === false) return [];
  const options = { treeSitter: treeSitterConfig };
  const languages = new Set();
  const add = (languageId) => {
    if (!languageId || !TREE_SITTER_LANG_IDS.has(languageId)) return;
    if (!isTreeSitterEnabled(options, languageId)) return;
    languages.add(languageId);
  };
  add(resolveTreeSitterLanguageForSegment(primaryLanguageId, ext));
  if (Array.isArray(segments)) {
    for (const segment of segments) {
      if (!segment || segment.type !== 'embedded') continue;
      const segmentExt = resolveSegmentExt(ext, segment);
      add(resolveTreeSitterLanguageForSegment(segment.languageId, segmentExt));
    }
  }
  return Array.from(languages);
};

const isTreeSitterSchedulerLanguage = (languageId) => (
  Boolean(languageId)
  && TREE_SITTER_LANG_IDS.has(languageId)
);

export {
  resolveTreeSitterLanguageForSegment,
  resolveTreeSitterLanguagesForSegments,
  isTreeSitterSchedulerLanguage
};
