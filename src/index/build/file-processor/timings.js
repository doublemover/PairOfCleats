export function createFileTimingTracker({ mode, featureMetrics }) {
  const fileTimings = {
    parseMs: 0,
    tokenizeMs: 0,
    enrichMs: 0,
    embeddingMs: 0
  };
  const settingMetrics = featureMetrics ? new Map() : null;
  const lineSpansByLanguage = featureMetrics ? new Map() : null;
  const totals = {
    git: 0,
    pythonAst: 0,
    embedding: 0,
    lint: 0,
    complexity: 0
  };
  const addSettingMetric = (setting, languageId, lines, durationMs, count = 1) => {
    if (!settingMetrics) return;
    const duration = Number(durationMs) || 0;
    if (duration <= 0) return;
    const langKey = languageId || 'unknown';
    const entry = settingMetrics.get(setting) || new Map();
    const current = entry.get(langKey) || { count: 0, lines: 0, durationMs: 0 };
    current.count += Number(count) || 0;
    current.lines += Number(lines) || 0;
    current.durationMs += duration;
    entry.set(langKey, current);
    settingMetrics.set(setting, entry);
  };
  const addLineSpan = (languageId, startLine, endLine) => {
    if (!lineSpansByLanguage) return;
    const langKey = languageId || 'unknown';
    const start = Number(startLine) || 1;
    const end = Number(endLine) || start;
    const spans = lineSpansByLanguage.get(langKey) || [];
    spans.push([start, Math.max(start, end)]);
    lineSpansByLanguage.set(langKey, spans);
  };
  const countLinesFromSpans = (spans) => {
    if (!Array.isArray(spans) || !spans.length) return 0;
    const sorted = spans.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    let total = 0;
    let currentStart = null;
    let currentEnd = null;
    for (const [start, end] of sorted) {
      if (currentStart === null) {
        currentStart = start;
        currentEnd = end;
        continue;
      }
      if (start > currentEnd + 1) {
        total += Math.max(0, currentEnd - currentStart + 1);
        currentStart = start;
        currentEnd = end;
      } else {
        currentEnd = Math.max(currentEnd, end);
      }
    }
    if (currentStart !== null) {
      total += Math.max(0, currentEnd - currentStart + 1);
    }
    return total;
  };
  const finalizeLanguageLines = ({ fileLineCount, fileLanguageId }) => {
    if (!featureMetrics) return { languageLines: null, languageSetKey: null };
    const languageLineMap = new Map();
    if (lineSpansByLanguage && lineSpansByLanguage.size) {
      for (const [languageId, spans] of lineSpansByLanguage.entries()) {
        const lineCount = countLinesFromSpans(spans);
        if (lineCount) languageLineMap.set(languageId, lineCount);
      }
    }
    if (!languageLineMap.size) {
      const fallbackLanguage = fileLanguageId || 'unknown';
      if (fileLineCount) languageLineMap.set(fallbackLanguage, fileLineCount);
    }
    const languageKeys = Array.from(languageLineMap.keys()).sort();
    const languageSetKey = languageKeys.length ? languageKeys.join('+') : 'unknown';
    return { languageLines: languageLineMap, languageSetKey };
  };
  const recordFeatureMetrics = ({
    gitBlameEnabled,
    embeddingEnabled,
    lintEnabled,
    complexityEnabled,
    fileLineCount,
    languageLines,
    languageSetKey
  }) => {
    if (!featureMetrics || !languageLines) return;
    const distributeSetting = (setting, durationMs) => {
      const duration = Number(durationMs) || 0;
      if (!duration || !languageLines) return;
      const totalLines = Number(fileLineCount) || 0;
      const fallbackTotal = Array.from(languageLines.values()).reduce(
        (sum, value) => sum + (Number(value) || 0),
        0
      );
      const lineTotal = totalLines > 0 ? totalLines : fallbackTotal;
      for (const [languageId, lineCount] of languageLines.entries()) {
        const lines = Number(lineCount) || 0;
        if (!lines) continue;
        const share = lineTotal > 0 ? lines / lineTotal : 0;
        const shareDuration = share > 0 ? duration * share : 0;
        addSettingMetric(setting, languageId, lines, shareDuration);
      }
    };
    if (gitBlameEnabled) distributeSetting('gitBlame', totals.git);
    if (totals.pythonAst) distributeSetting('pythonAst', totals.pythonAst);
    if (embeddingEnabled) distributeSetting('embeddings', totals.embedding);
    if (lintEnabled) distributeSetting('lint', totals.lint);
    if (complexityEnabled) distributeSetting('complexity', totals.complexity);
    if (settingMetrics) {
      for (const [setting, languages] of settingMetrics.entries()) {
        for (const [languageId, entry] of languages.entries()) {
          featureMetrics.recordSetting({
            mode,
            setting,
            languageId,
            languageSet: languageSetKey,
            lines: entry.lines,
            durationMs: entry.durationMs,
            count: entry.count
          });
        }
      }
    }
  };
  const recordFileMetrics = ({
    fileLineCount,
    fileStat,
    fileDurationMs,
    languageLines,
    languageSetKey
  }) => {
    if (!featureMetrics || !languageLines) return;
    featureMetrics.recordFile({
      mode,
      languageSet: languageSetKey,
      languageLines,
      lines: fileLineCount,
      bytes: fileStat.size,
      durationMs: fileDurationMs
    });
  };
  const buildFileMetrics = ({
    fileLineCount,
    fileStat,
    fileDurationMs,
    fileLanguageId,
    cached
  }) => ({
    languageId: fileLanguageId || null,
    bytes: fileStat.size,
    lines: fileLineCount,
    durationMs: fileDurationMs,
    parseMs: fileTimings.parseMs,
    tokenizeMs: fileTimings.tokenizeMs,
    enrichMs: fileTimings.enrichMs,
    embeddingMs: fileTimings.embeddingMs,
    cached
  });

  return {
    fileTimings,
    metricsCollector: settingMetrics ? { add: addSettingMetric } : null,
    addSettingMetric,
    addLineSpan,
    addParseDuration: (durationMs) => {
      fileTimings.parseMs += Number(durationMs) || 0;
    },
    addTokenizeDuration: (durationMs) => {
      fileTimings.tokenizeMs += Number(durationMs) || 0;
    },
    addEnrichDuration: (durationMs) => {
      fileTimings.enrichMs += Number(durationMs) || 0;
    },
    addEmbeddingDuration: (durationMs) => {
      const value = Number(durationMs) || 0;
      fileTimings.embeddingMs += value;
      totals.embedding += value;
    },
    addLintDuration: (durationMs) => {
      const value = Number(durationMs) || 0;
      fileTimings.enrichMs += value;
      totals.lint += value;
    },
    addComplexityDuration: (durationMs) => {
      const value = Number(durationMs) || 0;
      fileTimings.enrichMs += value;
      totals.complexity += value;
    },
    setGitDuration: (durationMs) => {
      totals.git = Number(durationMs) || 0;
    },
    setPythonAstDuration: (durationMs) => {
      totals.pythonAst = Number(durationMs) || 0;
    },
    finalizeLanguageLines,
    recordFeatureMetrics,
    recordFileMetrics,
    buildFileMetrics
  };
}
