import { sha1 } from '../../shared/hash.js';
import { normalizeLimit } from '../../shared/limits.js';
import { normalizeCdcOptions } from './cdc.js';

const CONFIG_EXTS = new Set([
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml'
]);

export const LANGUAGE_ID_EXT = new Map([
  ['javascript', '.js'],
  ['typescript', '.ts'],
  ['tsx', '.tsx'],
  ['jsx', '.jsx'],
  ['html', '.html'],
  ['css', '.css'],
  ['scss', '.css'],
  ['sass', '.css'],
  ['less', '.css'],
  ['markdown', '.md'],
  ['yaml', '.yaml'],
  ['json', '.json'],
  ['toml', '.toml'],
  ['ini', '.ini'],
  ['xml', '.xml'],
  ['python', '.py'],
  ['ruby', '.rb'],
  ['php', '.php'],
  ['go', '.go'],
  ['rust', '.rs'],
  ['java', '.java'],
  ['c', '.c'],
  ['cpp', '.cpp'],
  ['csharp', '.cs'],
  ['kotlin', '.kt'],
  ['sql', '.sql'],
  ['shell', '.sh'],
  ['cmake', '.cmake'],
  ['starlark', '.bzl'],
  ['nix', '.nix'],
  ['dart', '.dart'],
  ['scala', '.scala'],
  ['groovy', '.groovy'],
  ['r', '.r'],
  ['julia', '.jl'],
  ['handlebars', '.hbs'],
  ['mustache', '.mustache'],
  ['jinja', '.jinja'],
  ['razor', '.razor']
]);

export const CONFIG_LANGS = new Set(['json', 'yaml', 'toml']);

const MARKDOWN_FENCE_LANG_ALIASES = new Map([
  ['js', 'javascript'],
  ['javascript', 'javascript'],
  ['jsx', 'jsx'],
  ['ts', 'typescript'],
  ['typescript', 'typescript'],
  ['tsx', 'tsx'],
  ['html', 'html'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['sass', 'sass'],
  ['less', 'less'],
  ['json', 'json'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['toml', 'toml'],
  ['xml', 'xml'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['sh', 'shell'],
  ['bash', 'shell'],
  ['shell', 'shell'],
  ['py', 'python'],
  ['python', 'python'],
  ['rb', 'ruby'],
  ['ruby', 'ruby'],
  ['go', 'go'],
  ['rust', 'rust'],
  ['java', 'java'],
  ['c', 'c'],
  ['cpp', 'cpp'],
  ['csharp', 'csharp'],
  ['cs', 'csharp'],
  ['kotlin', 'kotlin'],
  ['kt', 'kotlin'],
  ['php', 'php'],
  ['sql', 'sql'],
  ['cmake', 'cmake'],
  ['bazel', 'starlark'],
  ['starlark', 'starlark'],
  ['bzl', 'starlark'],
  ['nix', 'nix'],
  ['dart', 'dart'],
  ['scala', 'scala'],
  ['groovy', 'groovy'],
  ['r', 'r'],
  ['julia', 'julia'],
  ['handlebars', 'handlebars'],
  ['hbs', 'handlebars'],
  ['mustache', 'mustache'],
  ['jinja', 'jinja'],
  ['jinja2', 'jinja'],
  ['django', 'jinja'],
  ['razor', 'razor'],
  ['cshtml', 'razor']
]);

export const resolveSegmentType = (mode, ext) => {
  if (mode === 'prose') return 'prose';
  if (CONFIG_EXTS.has(ext)) return 'config';
  return 'code';
};

export const resolveSegmentTokenMode = (segment) => {
  const hint = segment.embeddingContext || segment.meta?.embeddingContext || null;
  if (hint === 'prose') return 'prose';
  if (hint === 'code' || hint === 'config') return 'code';
  if (segment.type === 'prose' || segment.type === 'comment') return 'prose';
  return 'code';
};

export const shouldIndexSegment = (segment, tokenMode, fileMode) => {
  if (segment.type === 'embedded') return true;
  return tokenMode === fileMode;
};

export const resolveSegmentExt = (baseExt, segment) => {
  if (segment.ext) return segment.ext;
  if (segment.languageId && LANGUAGE_ID_EXT.has(segment.languageId)) {
    return LANGUAGE_ID_EXT.get(segment.languageId);
  }
  return baseExt;
};

export const buildSegmentId = (relPath, segment) => {
  const key = [
    relPath || '',
    segment.type,
    segment.languageId || '',
    segment.start,
    segment.end,
    segment.parentSegmentId || ''
  ].join('|');
  return `seg_${sha1(key)}`;
};

export const normalizeFenceLanguage = (raw) => {
  if (!raw) return null;
  const normalized = String(raw).trim().split(/\s+/)[0]?.toLowerCase();
  if (!normalized) return null;
  return MARKDOWN_FENCE_LANG_ALIASES.get(normalized) || normalized;
};

export function normalizeSegmentsConfig(input = {}) {
  const cfg = input && typeof input === 'object' ? input : {};
  const inlineCodeSpans = cfg.inlineCodeSpans === true;
  const cdcEnabled = cfg.cdc && typeof cfg.cdc === 'object' && cfg.cdc.enabled === true;
  return {
    inlineCodeSpans,
    inlineCodeMinChars: normalizeLimit(cfg.inlineCodeMinChars, 8),
    inlineCodeMaxSpans: normalizeLimit(cfg.inlineCodeMaxSpans, 200),
    inlineCodeMaxBytes: normalizeLimit(cfg.inlineCodeMaxBytes, 64 * 1024),
    frontmatterProse: cfg.frontmatterProse === true,
    onlyExtras: cfg.onlyExtras === true,
    cdc: cdcEnabled
      ? { enabled: true, ...normalizeCdcOptions(cfg.cdc || {}) }
      : { enabled: false, ...normalizeCdcOptions(cfg.cdc || {}) }
  };
}

export const normalizeLanguageHint = (raw, fallback) => {
  if (!raw) return fallback;
  const normalized = String(raw).trim().split(/\s+/)[0]?.toLowerCase();
  if (!normalized) return fallback;
  return MARKDOWN_FENCE_LANG_ALIASES.get(normalized) || normalized || fallback;
};

export const hasMeaningfulText = (text) => /\S/.test(text || '');
