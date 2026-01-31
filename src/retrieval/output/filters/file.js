import path from 'node:path';
import { compileSafeRegex } from '../../../shared/safe-regex.js';
import { defaultNormalize, normalizeList } from './predicates.js';
const normalizeFilePath = (value) => String(value || '').replace(/\\/g, '/');

const parseFileMatcher = ({ entry, normalizeFile, regexConfig }) => {
  const raw = String(entry || '').trim();
  if (!raw) return null;
  const regexMatch = raw.match(/^\/(.+)\/([a-z]*)$/i);
  if (regexMatch) {
    const pattern = regexMatch[1];
    const flags = regexMatch[2] || '';
    const matcher = compileSafeRegex(pattern, flags, regexConfig);
    if (matcher.regex) return { type: 'regex', value: matcher.regex };
    return { type: 'substring', value: normalizeFile(pattern) };
  }
  return { type: 'substring', value: normalizeFile(raw) };
};

export const buildFileFilters = ({ file, ext, lang, caseFile, normalize = defaultNormalize, regexConfig }) => {
  const normalizeFile = (value) => (
    caseFile ? normalizeFilePath(value) : normalize(normalizeFilePath(value))
  );
  const normalizeFilePrefilter = (value) => normalizeFilePath(value).toLowerCase();
  const fileMatchers = normalizeList(file)
    .map((entry) => parseFileMatcher({ entry, normalizeFile, regexConfig }))
    .filter(Boolean);
  const extNeedles = normalizeList(ext)
    .map((entry) => {
      let value = entry.toLowerCase();
      value = value.replace(/^\*+/, '');
      if (value && !value.startsWith('.')) value = `.${value}`;
      return value;
    })
    .filter(Boolean);
  const langNeedles = normalizeList(lang).map(normalize);

  return {
    fileMatchers,
    extNeedles,
    langNeedles,
    normalizeFile,
    normalizeFilePrefilter
  };
};

export const matchFileFilters = ({ chunk, fileMatchers, extNeedles, langNeedles, normalizeFile, normalize = defaultNormalize }) => {
  if (fileMatchers.length) {
    const fileValue = String(chunk?.file || '');
    const fileValueNorm = normalizeFile(fileValue);
    const matches = fileMatchers.some((matcher) => {
      if (matcher.type === 'regex') {
        matcher.value.lastIndex = 0;
        return matcher.value.test(fileValue);
      }
      return fileValueNorm.includes(matcher.value);
    });
    if (!matches) return false;
  }
  if (langNeedles.length) {
    const langValue = chunk?.metaV2?.lang
      || chunk?.metaV2?.effective?.languageId
      || chunk?.lang
      || null;
    if (!langValue) return false;
    if (!langNeedles.includes(normalize(langValue))) return false;
  }
  if (extNeedles.length) {
    const extValue = normalize(chunk?.ext || path.extname(chunk?.file || ''));
    if (!extNeedles.includes(extValue)) return false;
  }
  return true;
};
