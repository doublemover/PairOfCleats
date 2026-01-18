import path from 'node:path';
import picomatch from 'picomatch';
import { toPosix } from '../../shared/files.js';
import { EXTS_CODE, EXTS_PROSE } from '../constants.js';

const RECORD_EXT_TYPES = new Map([
  ['.log', 'log'],
  ['.out', 'log'],
  ['.trace', 'trace'],
  ['.stack', 'stack'],
  ['.stacktrace', 'stack'],
  ['.dmp', 'dump'],
  ['.dump', 'dump'],
  ['.gcov', 'coverage'],
  ['.lcov', 'coverage'],
  ['.coverage', 'coverage'],
  ['.tap', 'test']
]);

const CONTENT_SIGNAL_REGEXES = [
  /Traceback \(most recent call last\):/i,
  /Exception in thread/i,
  /(^|\n)\s*at\s+\S+.*:\d+:\d+/i,
  /\bpanic:\b/i,
  /\bSegmentation fault\b/i,
  /\bFATAL\b/i
];
const TIMESTAMP_REGEX = /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;

const normalizeGlobs = (value) => {
  if (!value) return [];
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return [];
};

const buildGlobMatcher = (globs) => {
  if (!globs.length) return null;
  const matchers = globs.map((pattern) => picomatch(pattern, { dot: true }));
  return (relPath) => matchers.some((matcher) => matcher(relPath));
};

export const normalizeRecordsConfig = (input = {}) => {
  const cfg = input && typeof input === 'object' ? input : {};
  return {
    detect: cfg.detect !== false,
    includeGlobs: normalizeGlobs(cfg.includeGlobs),
    excludeGlobs: normalizeGlobs(cfg.excludeGlobs),
    sniffBytes: Number.isFinite(Number(cfg.sniffBytes))
      ? Math.max(0, Math.floor(Number(cfg.sniffBytes)))
      : 16384
  };
};

const resolveRecordTypeByPath = (relPath, ext) => {
  if (ext && RECORD_EXT_TYPES.has(ext)) {
    return RECORD_EXT_TYPES.get(ext);
  }
  return 'log';
};

const detectRecordByPath = ({ relPath, ext, includeMatcher, excludeMatcher }) => {
  if (excludeMatcher && excludeMatcher(relPath)) {
    return { match: false, reason: 'exclude' };
  }
  if (includeMatcher && includeMatcher(relPath)) {
    return { match: true, reason: 'include', recordType: resolveRecordTypeByPath(relPath, ext) };
  }
  const baseType = ext && RECORD_EXT_TYPES.has(ext) ? RECORD_EXT_TYPES.get(ext) : null;
  if (baseType) {
    return { match: true, reason: 'ext', recordType: baseType };
  }
  return { match: false, reason: 'none' };
};

const detectRecordByContent = (text) => {
  if (!text) return { match: false, reason: 'empty' };
  for (const regex of CONTENT_SIGNAL_REGEXES) {
    if (regex.test(text)) {
      return { match: true, reason: 'content', recordType: 'stack' };
    }
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { match: false, reason: 'empty' };
  let timestampLines = 0;
  for (const line of lines) {
    if (TIMESTAMP_REGEX.test(line)) timestampLines += 1;
  }
  const ratio = timestampLines / lines.length;
  if (timestampLines >= 3 && ratio >= 0.3) {
    return { match: true, reason: 'timestamp', recordType: 'log' };
  }
  return { match: false, reason: 'none' };
};

export const shouldSniffRecordContent = (ext) => {
  const lowered = typeof ext === 'string' ? ext.toLowerCase() : '';
  if (!lowered) return true;
  if (RECORD_EXT_TYPES.has(lowered)) return false;
  if (EXTS_CODE.has(lowered)) return false;
  if (EXTS_PROSE.has(lowered)) return false;
  return ['.txt', '.text', '.err', '.stderr', '.stdout'].includes(lowered);
};

export const createRecordsClassifier = ({ root, config }) => {
  const normalized = normalizeRecordsConfig(config);
  const includeMatcher = buildGlobMatcher(normalized.includeGlobs);
  const excludeMatcher = buildGlobMatcher(normalized.excludeGlobs);
  const rootDir = root ? path.resolve(root) : null;
  const normalizeRel = (value) => {
    const rel = rootDir ? path.relative(rootDir, value) : value;
    return toPosix(rel);
  };
  const classify = ({ absPath, relPath, ext, sampleText }) => {
    const rel = relPath ? toPosix(relPath) : normalizeRel(absPath || '');
    if (!rel || rel.startsWith('..')) return null;
    const pathResult = detectRecordByPath({
      relPath: rel,
      ext,
      includeMatcher,
      excludeMatcher
    });
    if (pathResult.match) {
      return {
        source: 'repo',
        recordType: pathResult.recordType || 'log',
        reason: pathResult.reason
      };
    }
    if (!normalized.detect) return null;
    if (!shouldSniffRecordContent(ext)) return null;
    const contentResult = detectRecordByContent(sampleText || '');
    if (!contentResult.match) return null;
    return {
      source: 'repo',
      recordType: contentResult.recordType || 'log',
      reason: contentResult.reason
    };
  };
  return {
    config: normalized,
    classify
  };
};
