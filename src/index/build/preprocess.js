import fs from 'node:fs/promises';
import path from 'node:path';
import { getLanguageRouteForFile } from '../language-registry/routing.js';
import { countLinesForEntries } from '../../shared/file-stats.js';
import { isRelativePathEscape, toPosix } from '../../shared/file-paths.js';
import { runWithSettledConcurrency } from '../../shared/concurrency/run-with-queue.js';
import { coerceAbortSignal, throwIfAborted } from '../../shared/abort.js';
import { createFileScanner, readFileSample, preserveSourceSampleFailure } from './file-scan.js';
import { discoverEntries } from './discover.js';
import { forwardDiscoveryDirectoryInventory } from './discovery/directory-inventory.js';
import { createPreprocessSnapshotSession } from './preprocess-snapshot.js';
import { createRecordsClassifier } from './records.js';
import { captureRecordSamplePrefix, sampleRecordContent } from './record-sample.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../semantic/analysis-versions.js';
import { MARKDOWN_EXTS } from '../constants.js';
import { resolveFileCaps } from './file-processor/read.js';
import { isCodeEntryForPath, isProseEntryForPath } from './mode-routing.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import {
  buildGeneratedPolicyConfig,
  buildGeneratedPolicyDowngradePayload,
  resolveGeneratedPolicyDecision
} from './generated-policy.js';

const DOCUMENT_EXTS = new Set(['.pdf', '.docx']);
const isDocumentExt = (ext) => DOCUMENT_EXTS.has(String(ext || '').toLowerCase());
const EXTRACTED_PROSE_PREFILTER_SAMPLE_BYTES = 4096;
const EXTRACTED_PROSE_ALWAYS_INCLUDE_EXTS = MARKDOWN_EXTS;
const EXTRACTED_PROSE_SAMPLE_MARKER = /(^|\n)\s*(---|\+\+\+)\s*$|<!--|\/\*|\/\/|(^|\n)\s*#|```/m;

const isLikelyExtractedProseProseCandidate = ({ ext, sampleText }) => {
  const normalizedExt = String(ext || '').toLowerCase();
  if (EXTRACTED_PROSE_ALWAYS_INCLUDE_EXTS.has(normalizedExt)) return true;
  if (typeof sampleText !== 'string' || !sampleText.trim()) {
    // Be conservative when samples are unavailable.
    return true;
  }
  return EXTRACTED_PROSE_SAMPLE_MARKER.test(sampleText);
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
  for (const entry of Object.values(fileCaps?.byMode || {})) {
    if (Number.isFinite(Number(entry?.maxLines)) && Number(entry.maxLines) > 0) return true;
  }
  return false;
};


const isSupportedEntry = (entry, mode, { documentExtractionEnabled = false } = {}) => {
  if (!entry) return false;
  const proseAllowed = isProseEntryForPath({ ext: entry.ext, relPath: entry.rel });
  const codeAllowed = isCodeEntryForPath({
    ext: entry.ext,
    relPath: entry.rel,
    isSpecial: entry.isSpecial
  });
  if (mode === 'code') return codeAllowed;
  if (mode === 'extracted-prose') {
    return codeAllowed
      || (proseAllowed && entry.extractedProseCandidate !== false)
      || (documentExtractionEnabled && isDocumentExt(entry.ext));
  }
  if (mode === 'prose') return proseAllowed;
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
    if (!rel || !abs || isRelativePathEscape(rel)) {
      invalid.push({ rel, abs });
    }
  }
  return invalid;
};

export async function preprocessFiles({
  root,
  modes,
  documentExtractionConfig = null,
  semanticPolicy = null,
  recordsDir = null,
  recordsConfig = null,
  scmProvider = null,
  scmProviderImpl = null,
  scmRepoRoot = null,
  ignoreMatcher,
  generatedPolicy = null,
  maxFileBytes = null,
  fileCaps = null,
  maxDepth = null,
  maxFiles = null,
  fileScan = null,
  lineCounts = false,
  snapshotCache = null,
  concurrency = 8,
  log = null,
  abortSignal = null
}) {
  const effectiveAbortSignal = coerceAbortSignal(abortSignal);
  throwIfAborted(effectiveAbortSignal);
  const effectiveGeneratedPolicy = generatedPolicy && typeof generatedPolicy === 'object'
    ? generatedPolicy
    : buildGeneratedPolicyConfig({});
  const documentExtractionEnabled = documentExtractionConfig?.enabled === true;
  const { entries, skippedCommon, metrics: discoveryMetrics } = await discoverEntries({
    root,
    modes,
    recordsDir,
    recordsConfig,
    scmProvider,
    scmProviderImpl,
    scmRepoRoot,
    ignoreMatcher,
    generatedPolicy: effectiveGeneratedPolicy,
    maxFileBytes,
    fileCaps,
    maxDepth,
    maxFiles,
    abortSignal: effectiveAbortSignal
  });
  const fileScanner = createFileScanner(fileScan);
  const recordsClassifier = createRecordsClassifier({ root, config: recordsConfig });
  const recordSniffBytes = recordsClassifier?.config?.sniffBytes ?? 0;
  const needsLines = lineCounts === true || hasMaxLinesCaps(fileCaps);
  const retrySnapshot = {};
  const snapshot = needsLines ? await createPreprocessSnapshotSession({ root, snapshotCache,
    policy: {
      ignorePolicy: ignoreMatcher?.policyFingerprint || null, modes,
      generatedPolicy: { includePatterns: effectiveGeneratedPolicy.includePatterns || [],
        excludePatterns: effectiveGeneratedPolicy.excludePatterns || [], extractedProse: effectiveGeneratedPolicy.extractedProse || null },
      recordsDir, recordsConfig: recordsClassifier.config, recordsRoutingProducer: SEMANTIC_ANALYSIS_VERSIONS.recordsProducer,
      documentExtractionConfig,
      semanticRouting: { enabled: semanticPolicy?.enabled === true, languages: semanticPolicy?.languages || [] },
      fileScan, fileCaps, maxFileBytes, maxDepth, maxFiles, needsLines
    },
    sampleBytes: Math.ceil(Math.max(fileScanner.sampleSizeBytes || 0, recordSniffBytes, EXTRACTED_PROSE_PREFILTER_SAMPLE_BYTES)),
    signal: effectiveAbortSignal, metrics: retrySnapshot
  }) : null;
  const observations = new WeakMap();
  const replayed = new WeakSet();
  const scanSkips = [];
  await runWithSettledConcurrency(
    entries,
    Math.max(1, Math.floor(concurrency)),
    async (entry) => {
      throwIfAborted(effectiveAbortSignal);
      if (!entry) return;
      let observation = null;
      if (snapshot) {
        entry.preprocessInputKey = snapshot.inputKey(entry);
        const eligible = isSupportedEntry(entry, 'code', { documentExtractionEnabled })
          || isSupportedEntry(entry, 'prose', { documentExtractionEnabled }) || !!entry.record;
        if (eligible) {
          const reuse = await snapshot.reuse(entry);
          if (reuse?.hit) { replayed.add(entry); return; }
          observation = reuse?.observation || null;
          if (observation) {
            // Only the bounded worker-local sample survives classification; no corpus-sized prefix cache.
            observations.set(entry, { hash: observation.hash, sourceSha1: observation.sourceSha1, bytes: observation.bytes, lines: observation.lines });
          }
        }
      }
      const samplePrefixes = new WeakMap();
      let latestSamplePrefix = null;
      const sample = async (filename, bytes) => {
        let buffer;
        if (observation?.sample && (bytes <= observation.sample.length || observation.bytes <= observation.sample.length)) {
          buffer = observation.sample.subarray(0, Math.min(bytes, observation.sample.length));
        } else {
          buffer = await readFileSample(filename, bytes, root, { signal: effectiveAbortSignal });
        }
        latestSamplePrefix = captureRecordSamplePrefix(buffer, bytes);
        if (buffer) samplePrefixes.set(buffer, latestSamplePrefix);
        return buffer;
      };
      const scanResult = await fileScanner.scanFile({
        absPath: entry.abs,
        stat: entry.stat,
        ext: entry.ext,
        readSample: sample
      });
      const bypassBinarySkip = Boolean(
        scanResult?.skip?.reason === 'binary'
        && (documentExtractionEnabled && isDocumentExt(entry.ext)
          || semanticPolicy?.enabled && semanticPolicy.languages.includes('wasm') && modes.includes('code') && entry.ext === '.wasm')
      );
      let sampleText = null;
      let sampleBuffer = scanResult?.sampleBuffer || null;
      if (recordsClassifier && !entry.record) {
        let recordSampleText = null;
        if (recordsClassifier.shouldSniff({ absPath: entry.abs, relPath: entry.rel, ext: entry.ext })) {
          try {
            const recordSample = await sampleRecordContent({
              maxBytes: recordSniffBytes,
              prefix: sampleBuffer ? samplePrefixes.get(sampleBuffer) : latestSamplePrefix,
              readSample: bytes => sample(entry.abs, bytes)
            });
            recordSampleText = recordSample.text;
          } catch (error) {
            preserveSourceSampleFailure(error, 'preprocess-record-sample');
          }
        }
        const record = recordsClassifier.classify({
          absPath: entry.abs,
          relPath: entry.rel,
          ext: entry.ext,
          sampleText: recordSampleText
        });
        if (record) entry.record = record;
      }
      if (sampleText == null && sampleBuffer) {
        try {
          sampleText = sampleBuffer.toString('utf8');
        } catch {
          sampleText = null;
        }
      }
      // Records entries are already routed by discover/records classification;
      // do not re-downgrade them via generated/minified/vendor policy.
      const policyDecision = entry.record
        ? null
        : resolveGeneratedPolicyDecision({
          generatedPolicy: effectiveGeneratedPolicy,
          relPath: entry.rel,
          absPath: entry.abs,
          baseName: path.basename(entry.abs),
          scanSkip: scanResult?.skip || null
        });
      if (policyDecision?.downgrade) {
        entry.skip = {
          reason: policyDecision.classification || 'generated',
          indexMode: policyDecision.indexMode,
          downgrade: buildGeneratedPolicyDowngradePayload(policyDecision)
        };
        scanSkips.push({ file: entry.abs, ...entry.skip });
        return;
      }
      if (scanResult?.skip) {
        const scanReason = scanResult.skip.reason || 'oversize';
        const allowMinifiedByInclude = scanReason === 'minified'
          && policyDecision?.policy === 'include'
          && policyDecision?.indexMode === 'full';
        if (!bypassBinarySkip && !allowMinifiedByInclude) {
          entry.skip = scanResult.skip;
          scanSkips.push({ file: entry.abs, reason: scanResult.skip.reason, ...scanResult.skip });
          return;
        }
      }
      entry.scan = {
        checkedBinary: scanResult?.checkedBinary === true,
        checkedMinified: scanResult?.checkedMinified === true || bypassBinarySkip,
        bypassBinarySkip
      };
      const proseAllowed = isProseEntryForPath({ ext: entry.ext, relPath: entry.rel });
      const codeAllowed = isCodeEntryForPath({
        ext: entry.ext,
        relPath: entry.rel,
        isSpecial: entry.isSpecial
      });
      if (proseAllowed && !codeAllowed) {
        if (!sampleBuffer) {
          try {
            sampleBuffer = await sample(entry.abs, EXTRACTED_PROSE_PREFILTER_SAMPLE_BYTES);
          } catch (error) {
            preserveSourceSampleFailure(error, 'preprocess-extracted-prose-sample');
            sampleBuffer = null;
          }
        }
        if (sampleText == null && sampleBuffer) {
          try {
            sampleText = sampleBuffer.toString('utf8');
          } catch {
            sampleText = null;
          }
        }
        entry.extractedProseCandidate = isLikelyExtractedProseProseCandidate({
          ext: entry.ext,
          sampleText
        });
      }
    },
    {
      collectResults: false,
      signal: effectiveAbortSignal
    }
  );
  if (scanSkips.length) skippedCommon.push(...scanSkips);

  const supportedEntries = entries.filter((entry) => !entry.skip
    && (isSupportedEntry(entry, 'code', { documentExtractionEnabled })
      || isSupportedEntry(entry, 'prose', { documentExtractionEnabled })
      || isSupportedEntry(entry, 'records', { documentExtractionEnabled })));
  let lineCountMap = new Map();
  if (needsLines && supportedEntries.length) {
    throwIfAborted(effectiveAbortSignal);
    if (snapshot) {
      await runWithSettledConcurrency(supportedEntries, Math.max(1, Math.floor(concurrency)), async entry => {
        if (!replayed.has(entry)) await snapshot.countAndCapture(entry, observations.get(entry));
        lineCountMap.set(toPosix(entry.rel || ''), entry.lines);
      }, { collectResults: false, signal: effectiveAbortSignal });
    } else {
      lineCountMap = await countLinesForEntries(supportedEntries, {
        concurrency: Math.max(1, Math.floor(concurrency)), signal: effectiveAbortSignal
      });
      for (const entry of supportedEntries) {
        const lines = lineCountMap.get(toPosix(entry.rel || ''));
        if (Number.isFinite(lines)) entry.lines = lines;
      }
    }
    throwIfAborted(effectiveAbortSignal);
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
      if (!isSupportedEntry(entry, mode, { documentExtractionEnabled })) {
        modeSkipped.push({ file: entry.abs, reason: 'unsupported' });
        continue;
      }
      if (entry.skip) continue;
      const lang = (mode === 'code' || mode === 'extracted-prose')
        ? getLanguageRouteForFile(entry.ext, entry.rel)?.id || null
        : null;
      const { maxLines, maxBytes } = resolveFileCaps(fileCaps, entry.ext, lang, mode);
      if (maxBytes && entry.stat?.size > maxBytes) {
        modeSkipped.push({ file: entry.abs, reason: 'oversize', bytes: entry.stat.size, maxBytes });
        continue;
      }
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
    entriesByMode[mode] = forwardDiscoveryDirectoryInventory(entries, modeEntries);
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

  if (snapshot) await snapshot.seal(entries, skippedCommon, discoveryMetrics);

  const stats = {
    root,
    discovery: discoveryMetrics,
    ...(snapshotCache ? { retrySnapshot } : {}),
    createdAt: new Date().toISOString(),
    modes: statsByMode
  };
  if (log && typeof log === 'function') {
    const totalIncluded = Object.values(statsByMode).reduce((sum, entry) => sum + entry.included, 0);
    log(`→ Preprocess: ${totalIncluded.toLocaleString()} files across ${modes.length} mode(s).`);
  }
  return { entriesByMode, skippedByMode, lineCountsByMode, stats, sourceHashesByPath: snapshot?.sourceHashes() || null };
}

export async function writePreprocessStats(repoCacheRoot, stats) {
  if (!repoCacheRoot || !stats) return null;
  const output = path.join(repoCacheRoot, 'preprocess.json');
  try {
    await atomicWriteJson(output, stats, { spaces: 2, newline: false });
    return output;
  } catch (error) {
    observeStorageResource(error, { phase: 'preprocess-statistics-write' }).requireSettled();
    return null;
  }
}
