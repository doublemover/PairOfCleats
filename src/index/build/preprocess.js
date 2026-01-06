import fs from 'node:fs/promises';
import path from 'node:path';
import { EXTS_CODE, EXTS_PROSE } from '../constants.js';
import { getLanguageForFile } from '../language-registry.js';
import { countLinesForEntries } from '../../shared/file-stats.js';
import { toPosix } from '../../shared/files.js';
import { runWithConcurrency } from '../../shared/concurrency.js';
import { createFileScanner, readFileSample } from './file-scan.js';
import { discoverEntries } from './discover.js';

const normalizeLimit = (value, fallback) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
};

const hasMaxLinesCaps = (fileCaps) => {
  const defaultMax = fileCaps?.default?.maxLines;
  if (Number.isFinite(Number(defaultMax)) && Number(defaultMax) > 0) return true;
  const byExt = fileCaps?.byExt || {};
  for (const entry of Object.values(byExt)) {
    if (Number.isFinite(Number(entry?.maxLines)) && Number(entry.maxLines) > 0) return true;
  }
  const byLang = fileCaps?.byLanguage || {};
  for (const entry of Object.values(byLang)) {
    if (Number.isFinite(Number(entry?.maxLines)) && Number(entry.maxLines) > 0) return true;
  }
  return false;
};

const pickMinLimit = (...values) => {
  const candidates = values.filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.min(...candidates) : null;
};

const resolveMaxLines = ({ ext, lang }, fileCaps) => {
  const extKey = typeof ext === 'string' ? ext.toLowerCase() : '';
  const langKey = typeof lang === 'string' ? lang.toLowerCase() : '';
  const defaultCaps = fileCaps?.default || {};
  const extCaps = extKey ? fileCaps?.byExt?.[extKey] : null;
  const langCaps = langKey ? fileCaps?.byLanguage?.[langKey] : null;
  return pickMinLimit(defaultCaps.maxLines, extCaps?.maxLines, langCaps?.maxLines);
};

const isSupportedEntry = (entry, mode) => {
  if (!entry) return false;
  if (mode === 'code') return EXTS_CODE.has(entry.ext) || entry.isSpecial;
  if (mode === 'prose') return EXTS_PROSE.has(entry.ext);
  return false;
};

const summarizeSkips = (skipped) => {
  const counts = {};
  for (const entry of skipped) {
    const reason = entry?.reason || 'unknown';
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
};

const validateEntries = (entries) => {
  const invalid = [];
  for (const entry of entries || []) {
    const rel = entry?.rel || '';
    const abs = entry?.abs || '';
    if (!rel || !abs || rel.startsWith('..')) {
      invalid.push({ rel, abs });
    }
  }
  return invalid;
};

export async function preprocessFiles({
  root,
  modes,
  ignoreMatcher,
  maxFileBytes = null,
  fileCaps = null,
  fileScan = null,
  lineCounts = false,
  concurrency = 8,
  log = null
}) {
  const { entries, skippedCommon } = await discoverEntries({
    root,
    ignoreMatcher,
    maxFileBytes,
    fileCaps
  });
  const fileScanner = createFileScanner(fileScan);
  const scanSkips = [];
  await runWithConcurrency(
    entries,
    Math.max(1, Math.floor(concurrency)),
    async (entry) => {
      if (!entry) return;
      const scanResult = await fileScanner.scanFile({
        absPath: entry.abs,
        stat: entry.stat,
        ext: entry.ext,
        readSample: readFileSample
      });
      if (scanResult?.skip) {
        entry.skip = scanResult.skip;
        scanSkips.push({ file: entry.abs, reason: scanResult.skip.reason, ...scanResult.skip });
        return;
      }
      entry.scan = {
        checkedBinary: scanResult?.checkedBinary === true,
        checkedMinified: scanResult?.checkedMinified === true
      };
    },
    { collectResults: false }
  );
  if (scanSkips.length) skippedCommon.push(...scanSkips);

  const needsLines = lineCounts === true || hasMaxLinesCaps(fileCaps);
  const supportedEntries = entries.filter((entry) => !entry.skip
    && (isSupportedEntry(entry, 'code') || isSupportedEntry(entry, 'prose')));
  let lineCountMap = new Map();
  if (needsLines && supportedEntries.length) {
    lineCountMap = await countLinesForEntries(supportedEntries, {
      concurrency: Math.max(1, Math.floor(concurrency))
    });
    for (const entry of supportedEntries) {
      const lines = lineCountMap.get(toPosix(entry.rel || ''));
      if (Number.isFinite(lines)) entry.lines = lines;
    }
  }

  const entriesByMode = {};
  const skippedByMode = {};
  const lineCountsByMode = {};
  const statsByMode = {};
  for (const mode of modes) {
    const modeSkipped = [...skippedCommon];
    const modeEntries = [];
    for (const entry of entries) {
      if (!isSupportedEntry(entry, mode)) {
        modeSkipped.push({ file: entry.abs, reason: 'unsupported' });
        continue;
      }
      if (entry.skip) continue;
      const lang = mode === 'code'
        ? getLanguageForFile(entry.ext, entry.rel)?.id || null
        : null;
      const maxLines = resolveMaxLines({ ext: entry.ext, lang }, fileCaps);
      if (maxLines && Number.isFinite(entry.lines) && entry.lines > maxLines) {
        modeSkipped.push({
          file: entry.abs,
          reason: 'oversize',
          lines: entry.lines,
          maxLines
        });
        continue;
      }
      modeEntries.push({
        abs: entry.abs,
        rel: entry.rel,
        stat: entry.stat,
        ext: entry.ext,
        lines: entry.lines,
        scan: entry.scan
      });
    }
    entriesByMode[mode] = modeEntries;
    skippedByMode[mode] = modeSkipped;
    const modeLineCounts = new Map();
    for (const entry of modeEntries) {
      const lines = lineCountMap.get(toPosix(entry.rel || ''));
      if (Number.isFinite(lines)) modeLineCounts.set(toPosix(entry.rel || ''), lines);
    }
    lineCountsByMode[mode] = modeLineCounts;
    statsByMode[mode] = {
      totalCandidates: entries.length,
      included: modeEntries.length,
      skipped: summarizeSkips(modeSkipped),
      lines: modeEntries.reduce((sum, entry) => sum + (entry.lines || 0), 0)
    };
  }

  const invalidByMode = {};
  for (const mode of modes) {
    const invalid = validateEntries(entriesByMode[mode]);
    if (invalid.length) invalidByMode[mode] = invalid;
  }
  if (Object.keys(invalidByMode).length) {
    const detail = Object.entries(invalidByMode)
      .map(([mode, list]) => `${mode}:${list.length}`)
      .join(', ');
    throw new Error(`Preprocess output invalid (${detail}).`);
  }

  const stats = {
    root,
    createdAt: new Date().toISOString(),
    modes: statsByMode
  };
  if (log && typeof log === 'function') {
    const totalIncluded = Object.values(statsByMode).reduce((sum, entry) => sum + entry.included, 0);
    log(`→ Preprocess: ${totalIncluded.toLocaleString()} files across ${modes.length} mode(s).`);
  }
  return { entriesByMode, skippedByMode, lineCountsByMode, stats };
}

export async function writePreprocessStats(repoCacheRoot, stats) {
  if (!repoCacheRoot || !stats) return null;
  const output = path.join(repoCacheRoot, 'preprocess.json');
  try {
    await fs.mkdir(repoCacheRoot, { recursive: true });
    await fs.writeFile(output, JSON.stringify(stats, null, 2));
    return output;
  } catch {
    return null;
  }
}
