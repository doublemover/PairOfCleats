import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { tokenizeComments } from '../../../src/index/build/file-processor/cpu/tokenizer.js';
import { discoverFilesForModes } from '../../../src/index/build/discover.js';
import { extractDocx } from '../../../src/index/extractors/docx.js';
import { extractPdf } from '../../../src/index/extractors/pdf.js';
import { normalizeDocumentExtractionPolicy, normalizeExtractedText } from '../../../src/index/extractors/common.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { extractComments, normalizeCommentConfig } from '../../../src/index/comments.js';
import { detectFrontmatter } from '../../../src/index/segments.js';
import { runWithConcurrency } from '../../../src/shared/concurrency.js';
import { readTextFile } from '../../../src/shared/encoding.js';
import { buildLineIndex, offsetToLine } from '../../../src/shared/lines.js';
import { countLinesForEntries } from '../../../src/shared/file-stats.js';
import { formatDurationMs } from '../../../src/shared/time-format.js';
import { getTriageConfig } from '../../shared/dict-utils.js';
import { emitBenchLog } from './logging.js';

export const formatDuration = (ms) => formatDurationMs(ms);

export const formatGb = (mb) => `${(mb / 1024).toFixed(1)} GB`;

export const formatLoc = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${Math.floor(value)}`;
};

export const stripMaxOldSpaceFlag = (options) => {
  if (!options) return '';
  return options
    .replace(/--max-old-space-size=\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export const getRecommendedHeapMb = () => {
  const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
  const recommended = Math.max(4096, Math.floor(totalMb * 0.75));
  const rounded = Math.floor(recommended / 256) * 256;
  return {
    totalMb,
    recommendedMb: Math.max(4096, rounded)
  };
};

export const formatMetricSummary = (summary) => {
  if (!summary) return 'Metrics: pending';
  const backends = summary.backends || Object.keys(summary.latencyMsAvg || {});
  const parts = [];
  for (const backend of backends) {
    const latency = summary.latencyMsAvg?.[backend];
    const hitRate = summary.hitRate?.[backend];
    const latencyText = Number.isFinite(latency) ? `${latency.toFixed(1)}ms` : 'n/a';
    const hitText = Number.isFinite(hitRate) ? `${(hitRate * 100).toFixed(1)}%` : 'n/a';
    parts.push(`${backend} ${latencyText} hit ${hitText}`);
  }
  if (summary.embeddingProvider) {
    parts.push(`embed ${summary.embeddingProvider}`);
  }
  return parts.length ? `Metrics: ${parts.join(' | ')}` : 'Metrics: pending';
};

const resolveMaxFileBytes = (userConfig) => {
  const raw = userConfig?.indexing?.maxFileBytes;
  const parsed = Number(raw);
  if (raw === false || raw === 0) return null;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return 5 * 1024 * 1024;
};

const DOCUMENT_EXTS = new Set(['.pdf', '.docx']);
const EMPTY_TOKEN_DICT = new Set();

const countTextLines = (text) => {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
};

const buildPdfExtractionText = (pages) => {
  const parts = [];
  for (const page of pages || []) {
    const text = normalizeExtractedText(page?.text || '');
    if (!text) continue;
    parts.push(text);
  }
  return parts.join('\n\n');
};

const buildDocxExtractionText = (paragraphs) => {
  const parts = [];
  for (const paragraph of paragraphs || []) {
    const text = normalizeExtractedText(paragraph?.text || '');
    if (!text) continue;
    parts.push(text);
  }
  return parts.join('\n\n');
};

/**
 * Convert extra-segment offset spans into a de-duplicated line count.
 * Overlaps (for example comment + embedded config segments on the same lines)
 * are merged so extracted LOC reflects unique indexed lines.
 *
 * @param {{segments:Array<object>, lineIndex:number[], textLength:number}} input
 * @returns {number}
 */
const countUniqueSegmentLines = ({ segments, lineIndex, textLength }) => {
  if (!Array.isArray(segments) || segments.length === 0 || !textLength) return 0;
  const maxOffset = Math.max(0, textLength - 1);
  const ranges = [];
  for (const segment of segments) {
    const rawStart = Number(segment?.start);
    const rawEnd = Number(segment?.end);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) continue;
    const start = Math.max(0, Math.min(maxOffset, Math.floor(rawStart)));
    const endExclusive = Math.max(start + 1, Math.min(textLength, Math.floor(rawEnd)));
    const startLine = offsetToLine(lineIndex, start);
    const endLine = offsetToLine(lineIndex, Math.max(start, endExclusive - 1));
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || endLine < startLine) continue;
    ranges.push([startLine, endLine]);
  }
  if (!ranges.length) return 0;
  ranges.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  let total = 0;
  let currentStart = ranges[0][0];
  let currentEnd = ranges[0][1];
  for (let i = 1; i < ranges.length; i += 1) {
    const [nextStart, nextEnd] = ranges[i];
    if (nextStart <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, nextEnd);
      continue;
    }
    total += currentEnd - currentStart + 1;
    currentStart = nextStart;
    currentEnd = nextEnd;
  }
  total += currentEnd - currentStart + 1;
  return total;
};

const collectExtractedProseSegmentsForText = ({ text, ext, rel, normalizedCommentsConfig }) => {
  const lineIndex = buildLineIndex(text);
  const languageId = getLanguageForFile(ext, rel)?.id || null;
  const commentData = normalizedCommentsConfig.extract !== 'off'
    ? extractComments({
      text,
      ext,
      languageId,
      lineIndex,
      config: normalizedCommentsConfig
    })
    : { comments: [], configSegments: [] };
  const { commentSegments } = tokenizeComments({
    comments: commentData.comments,
    ext,
    tokenDictWords: EMPTY_TOKEN_DICT,
    dictConfig: null,
    normalizedCommentsConfig,
    languageId,
    commentSegmentsEnabled: true
  });
  const segments = [];
  if (Array.isArray(commentSegments) && commentSegments.length) {
    segments.push(...commentSegments);
  }
  if (Array.isArray(commentData.configSegments) && commentData.configSegments.length) {
    segments.push(...commentData.configSegments);
  }
  if (ext === '.md' || ext === '.mdx') {
    const frontmatter = detectFrontmatter(text);
    if (frontmatter) {
      segments.push({
        type: 'prose',
        languageId: 'markdown',
        start: frontmatter.start,
        end: frontmatter.end,
        parentSegmentId: null,
        embeddingContext: 'prose',
        meta: { frontmatter: true }
      });
    }
  }
  return { lineIndex, segments };
};

const countExtractedDocumentLines = async ({ entry, documentExtractionPolicy }) => {
  const extracted = entry.ext === '.pdf'
    ? await extractPdf({ filePath: entry.abs, policy: documentExtractionPolicy })
    : await extractDocx({ filePath: entry.abs, policy: documentExtractionPolicy });
  if (!extracted?.ok) return 0;
  const extractedText = entry.ext === '.pdf'
    ? buildPdfExtractionText(extracted.pages)
    : buildDocxExtractionText(extracted.paragraphs);
  return countTextLines(extractedText);
};

const countExtractedProseLinesForEntry = async ({
  entry,
  normalizedCommentsConfig,
  documentExtractionEnabled,
  documentExtractionPolicy
}) => {
  if (documentExtractionEnabled && DOCUMENT_EXTS.has(entry.ext)) {
    try {
      return await countExtractedDocumentLines({ entry, documentExtractionPolicy });
    } catch {
      return 0;
    }
  }
  let text = '';
  try {
    ({ text } = await readTextFile(entry.abs));
  } catch {
    return 0;
  }
  if (!text) return 0;
  const { lineIndex, segments } = collectExtractedProseSegmentsForText({
    text,
    ext: entry.ext,
    rel: entry.rel,
    normalizedCommentsConfig
  });
  return countUniqueSegmentLines({
    segments,
    lineIndex,
    textLength: text.length
  });
};

/**
 * Count extracted-prose lines by simulating the same extras-only segment path
 * used by indexing in `extracted-prose` mode.
 *
 * @param {Array<{abs:string,rel:string,ext:string}>} entries
 * @param {{concurrency:number, normalizedCommentsConfig:object, documentExtractionConfig:object|null}} options
 * @returns {Promise<Map<string, number>>}
 */
const countExtractedProseLinesForEntries = async (entries, {
  concurrency,
  normalizedCommentsConfig,
  documentExtractionConfig
}) => {
  const lineCounts = new Map();
  if (!Array.isArray(entries) || entries.length === 0) return lineCounts;
  const documentExtractionEnabled = documentExtractionConfig?.enabled === true;
  const documentExtractionPolicy = normalizeDocumentExtractionPolicy(documentExtractionConfig);
  await runWithConcurrency(
    entries,
    concurrency,
    async (entry) => {
      const rel = String(entry.rel || entry.abs || '').replace(/\\/g, '/');
      if (!rel) return;
      const lines = await countExtractedProseLinesForEntry({
        entry,
        normalizedCommentsConfig,
        documentExtractionEnabled,
        documentExtractionPolicy
      });
      lineCounts.set(rel, lines);
    },
    { collectResults: false }
  );
  return lineCounts;
};

export const buildLineStats = async (repoPath, userConfig) => {
  const modes = ['code', 'prose', 'extracted-prose', 'records'];
  const { ignoreMatcher } = await buildIgnoreMatcher({ root: repoPath, userConfig });
  const skippedByMode = { code: [], prose: [], 'extracted-prose': [], records: [] };
  const maxFileBytes = resolveMaxFileBytes(userConfig);
  const indexingConfig = userConfig?.indexing && typeof userConfig.indexing === 'object'
    ? userConfig.indexing
    : {};
  const normalizedCommentsConfig = normalizeCommentConfig(indexingConfig.comments || {});
  const documentExtractionConfig = indexingConfig.documentExtraction || null;
  const triageConfig = getTriageConfig(repoPath, userConfig);
  const recordsConfig = userConfig.records || null;
  const entriesByMode = await discoverFilesForModes({
    root: repoPath,
    modes,
    documentExtractionConfig,
    recordsDir: triageConfig.recordsDir,
    recordsConfig,
    ignoreMatcher,
    skippedByMode,
    maxFileBytes
  });
  const linesByFile = {
    code: new Map(),
    prose: new Map(),
    'extracted-prose': new Map(),
    records: new Map()
  };
  const totals = { code: 0, prose: 0, 'extracted-prose': 0, records: 0 };
  const concurrency = Math.max(1, Math.min(32, os.cpus().length * 2));
  for (const mode of modes) {
    const entries = entriesByMode[mode] || [];
    if (!entries.length) continue;
    const lineCounts = mode === 'extracted-prose'
      ? await countExtractedProseLinesForEntries(entries, {
        concurrency,
        normalizedCommentsConfig,
        documentExtractionConfig
      })
      : await countLinesForEntries(entries, { concurrency });
    for (const [rel, lines] of lineCounts) {
      linesByFile[mode].set(rel, lines);
      totals[mode] += lines;
    }
  }
  return { totals, linesByFile };
};

export const validateEncodingFixtures = async (scriptRoot, { onLog = null } = {}) => {
  const warn = (message) => emitBenchLog(onLog, message, 'warn');
  const fixturePath = path.join(scriptRoot, 'tests', 'fixtures', 'encoding', 'latin1.js');
  if (!fs.existsSync(fixturePath)) return;
  try {
    const { text, usedFallback } = await readTextFile(fixturePath);
    const expected = 'caf\u00e9';
    if (!text.includes(expected) || !usedFallback) {
      warn(`[bench] Encoding fixture did not decode as expected: ${fixturePath}`);
    }
  } catch (err) {
    warn(`[bench] Encoding fixture read failed: ${err?.message || err}`);
  }
};
