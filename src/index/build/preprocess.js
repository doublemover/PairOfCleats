import fs from 'node:fs/promises';
import path from 'node:path';
import { EXTS_CODE, EXTS_PROSE } from '../constants.js';
import { getLanguageForFile } from '../language-registry.js';
import { countLinesForEntries } from '../../shared/file-stats.js';
import { toPosix } from '../../shared/files.js';
import { runWithConcurrency } from '../../shared/concurrency.js';
import { throwIfAborted } from '../../shared/abort.js';
import { createFileScanner, readFileSample } from './file-scan.js';
import { discoverEntries } from './discover.js';
import { createRecordsClassifier, shouldSniffRecordContent } from './records.js';
import { pickMinLimit } from './runtime/limits.js';

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
  if (mode === 'extracted-prose') {
    return EXTS_CODE.has(entry.ext) || EXTS_PROSE.has(entry.ext) || entry.isSpecial;
  }
  if (mode === 'prose') return EXTS_PROSE.has(entry.ext);
  if (mode === 'records') return !!entry.record;
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
  recordsDir = null,
  recordsConfig = null,
  scmProvider = null,
  scmProviderImpl = null,
  scmRepoRoot = null,
  ignoreMatcher,
  maxFileBytes = null,
  fileCaps = null,
  maxDepth = null,
  maxFiles = null,
  fileScan = null,
  lineCounts = false,
  concurrency = 8,
  log = null,
  abortSignal = null
}) {
  throwIfAborted(abortSignal);
  const { entries, skippedCommon } = await discoverEntries({
    root,
    recordsDir,
    recordsConfig,
    scmProvider,
    scmProviderImpl,
    scmRepoRoot,
    ignoreMatcher,
    maxFileBytes,
    fileCaps,
    maxDepth,
    maxFiles,
    abortSignal
  });
  const fileScanner = createFileScanner(fileScan);
  const recordsClassifier = createRecordsClassifier({ root, config: recordsConfig });
  const recordSniffBytes = recordsClassifier?.config?.sniffBytes ?? 0;
  const scanSkips = [];
  await runWithConcurrency(
    entries,
    Math.max(1, Math.floor(concurrency)),
    async (entry) => {
      throwIfAborted(abortSignal);
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
      if (recordsClassifier && !entry.record) {
        let sampleText = null;
        let sampleBuffer = scanResult?.sampleBuffer || null;
        if (!sampleBuffer && recordSniffBytes > 0 && shouldSniffRecordContent(entry.ext)) {
          try {
            sampleBuffer = await readFileSample(entry.abs, recordSniffBytes);
          } catch {
            sampleBuffer = null;
          }
        }
        if (sampleBuffer) {
          try {
            sampleText = sampleBuffer.toString('utf8');
          } catch {
            sampleText = null;
          }
        }
        const record = recordsClassifier.classify({
          absPath: entry.abs,
          relPath: entry.rel,
          ext: entry.ext,
          sampleText
        });
        if (record) entry.record = record;
      }
      entry.scan = {
        checkedBinary: scanResult?.checkedBinary === true,
        checkedMinified: scanResult?.checkedMinified === true
      };
    },
    { collectResults: false, signal: abortSignal }
  );
  if (scanSkips.length) skippedCommon.push(...scanSkips);

  const needsLines = lineCounts === true || hasMaxLinesCaps(fileCaps);
  const supportedEntries = entries.filter((entry) => !entry.skip
    && (isSupportedEntry(entry, 'code') || isSupportedEntry(entry, 'prose') || isSupportedEntry(entry, 'records')));
  let lineCountMap = new Map();
  if (needsLines && supportedEntries.length) {
    throwIfAborted(abortSignal);
    lineCountMap = await countLinesForEntries(supportedEntries, {
      concurrency: Math.max(1, Math.floor(concurrency))
    });
    throwIfAborted(abortSignal);
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
      if (entry.record && mode !== 'records') {
        modeSkipped.push({
          file: entry.abs,
          reason: 'records',
          recordType: entry.record.recordType || null
        });
        continue;
      }
      if (!isSupportedEntry(entry, mode)) {
        modeSkipped.push({ file: entry.abs, reason: 'unsupported' });
        continue;
      }
      if (entry.skip) continue;
      const lang = (mode === 'code' || mode === 'extracted-prose')
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
        scan: entry.scan,
        ...(entry.record ? { record: entry.record } : {})
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
