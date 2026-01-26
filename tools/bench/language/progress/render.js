import readline from 'node:readline';
import { formatShardFileProgress } from '../../../../src/shared/bench-progress.js';
import { ANSI } from '../../../../src/shared/cli/ansi-utils.js';
import { toPosix } from '../../../../src/shared/files.js';
import { formatDuration, formatLoc } from '../metrics.js';
import {
  parseFileProgressLine,
  parseImportStatsLine,
  parseLineProgress,
  parseProgressLine,
  parseScanMode,
  parseShardLine
} from './parse.js';
import { resetBuildProgressState } from './state.js';

const DIM_TEXT = `${ANSI.dim}${ANSI.fgDarkGray}`;

export const createProgressRenderer = ({
  state,
  interactive,
  quietMode,
  colorEnabled,
  writeLog,
  getActiveLabel
}) => {
  const pushHistory = (line) => {
    if (!line) return;
    state.logHistory.push(line);
    if (state.logHistory.length > state.logHistorySize) state.logHistory.shift();
  };

  const truncateDisplay = (line) => {
    if (!line) return '';
    const width = Number.isFinite(process.stderr.columns) ? process.stderr.columns : 120;
    if (line.length <= width) return line;
    return `${line.slice(0, Math.max(0, width - 1))}\u2026`;
  };

  const extractLogTag = (line) => {
    if (!line) return '';
    const match = /^\s*\[([^\]]+)\]\s*/.exec(line);
    return match ? match[1].trim().toLowerCase() : '';
  };

  const resolveLogTag = (line, tagOverride) => {
    if (tagOverride) return String(tagOverride).trim().toLowerCase();
    return extractLogTag(line);
  };

  const shouldUpdateLogWindowLine = (line, tag) => {
    if (!tag) return true;
    const now = Date.now();
    const last = state.logUpdateByTag.get(tag);
    if (last) {
      if (last.line === line) return false;
      if (now - last.at < state.logUpdateDebounceMs) return false;
    }
    state.logUpdateByTag.set(tag, { line, at: now });
    return true;
  };

  const upsertLogWindowLine = (line, tagOverride) => {
    const tag = resolveLogTag(line, tagOverride);
    if (!tag) return false;
    for (let i = state.logLines.length - 1; i >= 0; i -= 1) {
      const existingTag = state.logLineTags[i] || extractLogTag(state.logLines[i]);
      if (existingTag && existingTag === tag) {
        state.logLines[i] = line;
        state.logLineTags[i] = tag;
        return true;
      }
    }
    return false;
  };

  const pushLogWindowLine = (line, options = {}) => {
    if (!interactive) return;
    const tag = resolveLogTag(line, options.tag);
    if (!shouldUpdateLogWindowLine(line, tag)) return;
    const replaced = tag ? upsertLogWindowLine(line, tag) : false;
    if (!replaced) {
      state.logLines.push(line);
      state.logLineTags.push(tag || '');
      if (state.logLines.length > state.logWindowSize) state.logLines.shift();
      if (state.logLineTags.length > state.logWindowSize) state.logLineTags.shift();
    }
    renderStatus();
  };

  const styleText = (text, prefix) => {
    if (!colorEnabled || !text) return text;
    return `${prefix}${text}${ANSI.reset}`;
  };

  const formatBarLine = (line, width) => {
    const content = line || '';
    const truncated = content.length > width
      ? `${content.slice(0, Math.max(0, width - 1))}\u2026`
      : content;
    if (!colorEnabled) return truncated;
    const padded = truncated.padEnd(width, ' ');
    return `${ANSI.bgBlack}${ANSI.fgLight}${padded}${ANSI.reset}`;
  };

  const formatLogLine = (line) => {
    const content = line || '';
    if (!colorEnabled) return content;
    if (/^\s*(?:\u2192|->)\s*Shard\s+/i.test(content)) {
      return styleText(content, ANSI.fgBrightWhite);
    }
    if (/^\s*\[shard\s+/i.test(content)
      || /^\s*Files\s+\d+\/\d+/i.test(content)
      || /^\s*File\s+\d+\/\d+/i.test(content)) {
      return styleText(content, DIM_TEXT);
    }
    return content;
  };

  const renderStatus = () => {
    if (!interactive) return;
    if (!state.statusRendered) {
      process.stderr.write('\n'.repeat(state.logWindowSize + 3));
      state.statusRendered = true;
    }
    readline.moveCursor(process.stderr, 0, -(state.logWindowSize + 3));
    const lines = [...state.logLines];
    const width = Number.isFinite(process.stderr.columns) ? process.stderr.columns : 120;
    while (lines.length < state.logWindowSize) lines.push('');
    lines.push(state.metricsLine);
    lines.push(state.fileProgressLine);
    lines.push(state.progressLine);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const isBar = i >= state.logWindowSize;
      readline.clearLine(process.stderr, 0);
      const output = isBar
        ? formatBarLine(line || '', width)
        : formatLogLine(truncateDisplay(line || ''));
      process.stderr.write(output);
      process.stderr.write('\n');
    }
  };

  const parseDurationText = (text) => {
    if (!text) return null;
    const hours = /(\d+)\s*h/i.exec(text);
    const minutes = /(\d+)\s*m/i.exec(text);
    const seconds = /(\d+)\s*s/i.exec(text);
    const totalSeconds = (hours ? Number(hours[1]) * 3600 : 0)
      + (minutes ? Number(minutes[1]) * 60 : 0)
      + (seconds ? Number(seconds[1]) : 0);
    return Number.isFinite(totalSeconds) ? totalSeconds * 1000 : null;
  };

  const setProgressBase = (message) => {
    state.progressLineBase = message || '';
    state.progressLinePrefix = '';
    state.progressLineSuffix = '';
    state.progressElapsedStartMs = null;
    if (!message) return;
    const match = message.match(/^(.*\| elapsed )([^|]+)(.*)$/);
    if (!match) return;
    const parsedMs = parseDurationText(match[2].trim());
    if (!Number.isFinite(parsedMs)) return;
    state.progressLinePrefix = match[1];
    state.progressLineSuffix = match[3] || '';
    state.progressElapsedStartMs = Date.now() - parsedMs;
  };

  const getActiveShardList = (now = Date.now()) => {
    const active = [];
    for (const [index, lastSeen] of state.activeShards.entries()) {
      if (now - lastSeen <= state.activeShardWindowMs) {
        active.push(index);
      } else {
        state.activeShards.delete(index);
      }
    }
    active.sort((a, b) => a - b);
    return active;
  };

  const formatImportStats = (stats) => {
    if (!stats) return '';
    const parts = [];
    if (Number.isFinite(stats.modules)) parts.push(`${stats.modules} mods`);
    if (Number.isFinite(stats.edges)) parts.push(`${stats.edges} edges`);
    if (Number.isFinite(stats.files)) parts.push(`${stats.files} files`);
    if (!parts.length) return '';
    return `imports ${parts.join(', ')}`;
  };

  const buildProgressLineExtras = (now = Date.now()) => {
    const segments = [];
    const shardList = getActiveShardList(now);
    if (shardList.length) {
      segments.push(`shards ${shardList.join(',')}`);
    }
    if (state.build.step?.toLowerCase() === 'imports') {
      const importText = formatImportStats(state.build.importStats);
      if (importText) segments.push(importText);
    }
    return segments.length ? ` | ${segments.join(' | ')}` : '';
  };

  const buildProgressLineBase = (now = Date.now()) => {
    if (state.progressLinePrefix && Number.isFinite(state.progressElapsedStartMs)) {
      return `${state.progressLinePrefix}${formatDuration(now - state.progressElapsedStartMs)}${state.progressLineSuffix}`;
    }
    return state.progressLineBase;
  };

  const renderProgressLine = ({ now = Date.now(), log = false, force = false } = {}) => {
    const baseLine = buildProgressLineBase(now);
    const extra = buildProgressLineExtras(now);
    let line = baseLine || '';
    if (extra) {
      line = baseLine ? `${baseLine}${extra}` : extra.replace(/^\s*\|\s*/, '');
    }
    if (!force && line === state.progressLine) return;
    state.progressLine = line;
    renderStatus();
    if (log && line && line !== state.lastProgressLogged) {
      writeLog(`[progress] ${line}`);
      state.lastProgressLogged = line;
    }
    if (log && !interactive && !quietMode && line !== state.lastProgressMessage) {
      console.error(line);
      state.lastProgressMessage = line;
    }
  };

  const updateProgress = (message) => {
    setProgressBase(message);
    renderProgressLine({ log: true, force: true });
  };

  const updateMetrics = (message) => {
    state.metricsLine = message;
    renderStatus();
    if (message && message !== state.lastMetricsLogged) {
      writeLog(`[metrics] ${message}`);
      state.lastMetricsLogged = message;
    }
    if (!interactive && !quietMode && message) {
      console.error(message);
    }
  };

  const updateFileProgressLine = () => {
    const file = state.build.currentFile;
    const current = state.build.currentLine;
    const total = state.build.currentLineTotal;
    if (!file) {
      state.fileProgressLine = '';
      renderStatus();
      return;
    }
    const lineSegment = total > 0 ? ` [${current}/${total}]` : '';
    const shardIndex = state.build.currentShardIndex;
    const shardTotal = state.build.currentShardTotal;
    const shardLabel = (Number.isFinite(shardIndex) && Number.isFinite(shardTotal))
      ? `${shardIndex}/${shardTotal}`
      : '';
    const shardSegment = shardLabel ? `[shard ${shardLabel}] ` : '[shard] ';
    state.fileProgressLine = `${shardSegment}${file}${lineSegment}`;
    renderStatus();
  };

  const refreshProgressLine = (now = Date.now(), force = false) => {
    if (!interactive) return;
    if (!force && now - state.lastProgressRefreshMs < state.progressRefreshMs) return;
    state.lastProgressRefreshMs = now;
    renderProgressLine({ now, force });
  };

  const handleShardLine = (line) => {
    const entry = parseShardLine(line);
    if (!entry) return false;
    if (entry.shardLabel && Number.isFinite(entry.index) && Number.isFinite(entry.total)) {
      state.shardByLabel.set(entry.shardLabel, { index: entry.index, total: entry.total });
    }
    return true;
  };

  const handleImportStatsLine = (line) => {
    const stats = parseImportStatsLine(line);
    if (!stats) return false;
    state.build.importStats = stats;
    return true;
  };

  const handleBuildMode = (line) => {
    const mode = parseScanMode(line);
    if (!mode) return;
    if (mode === 'code' || mode === 'prose' || mode === 'extracted-prose' || mode === 'records') {
      state.build.mode = mode;
    }
  };

  const resolveModeForFile = (rel) => {
    if (!rel) return null;
    if (state.build.linesByFile.code?.has(rel)) return 'code';
    if (state.build.linesByFile.prose?.has(rel)) return 'prose';
    if (state.build.linesByFile['extracted-prose']?.has(rel)) return 'extracted-prose';
    if (state.build.linesByFile.records?.has(rel)) return 'records';
    return null;
  };

  const handleBuildFileLine = (lineOrEntry) => {
    const entry = typeof lineOrEntry === 'string' ? parseFileProgressLine(lineOrEntry) : lineOrEntry;
    if (!entry || !entry.file) return;
    const rawPath = entry.file.trim();
    if (!rawPath) return;
    const rel = toPosix(rawPath);
    const inferredMode = resolveModeForFile(rel);
    if (inferredMode && inferredMode !== state.build.mode) {
      state.build.mode = inferredMode;
    }
    const mode = state.build.mode;
    if (!mode || !state.build.linesByFile[mode]) return;
    state.build.currentFile = rel;
    state.build.currentLineTotal = state.build.linesByFile[mode].get(rel) || 0;
    state.build.currentLine = 0;
    const shardLabel = entry.shardLabel;
    const shardInfo = shardLabel ? state.shardByLabel.get(shardLabel) : null;
    state.build.currentShard = shardLabel || null;
    state.build.currentShardIndex = shardInfo?.index ?? null;
    state.build.currentShardTotal = shardInfo?.total ?? null;
    if (Number.isFinite(state.build.currentShardIndex)) {
      state.activeShards.set(state.build.currentShardIndex, Date.now());
    }
    updateFileProgressLine();
    const seen = state.build.filesSeen[mode];
    if (seen.has(rel)) return;
    const lineCount = state.build.linesByFile[mode].get(rel);
    if (!Number.isFinite(lineCount)) return;
    seen.add(rel);
    state.build.linesProcessed[mode] += lineCount;
  };

  const handleBuildLineProgress = (line) => {
    const progress = parseLineProgress(line);
    if (!progress) return;
    const { current, total } = progress;
    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return;
    state.build.currentLine = current;
    state.build.currentLineTotal = total;
    updateFileProgressLine();
  };

  const handleBuildProgress = (line) => {
    const parsed = parseProgressLine(line);
    if (!parsed) return false;
    const { step, count, total, pct } = parsed;
    if (!Number.isFinite(count) || !Number.isFinite(total) || !Number.isFinite(pct) || total <= 0) {
      return true;
    }
    const label = state.currentRepoLabel || (getActiveLabel ? getActiveLabel() : '') || '';
    const now = Date.now();
    if (
      state.build.step !== step
      || state.build.total !== total
      || count < state.build.lastCount
      || state.build.label !== label
    ) {
      state.build.step = step;
      state.build.total = total;
      state.build.startMs = now;
      state.build.lastLoggedMs = 0;
      state.build.lastCount = 0;
      state.build.lastPct = 0;
      state.build.label = label;
    }
    if (!state.build.startMs) state.build.startMs = now;
    const elapsedMs = now - state.build.startMs;
    const rate = elapsedMs > 0 ? count / (elapsedMs / 1000) : 0;
    const remaining = total - count;
    let etaMs = rate > 0 && remaining > 0 ? (remaining / rate) * 1000 : 0;
    let lineRate = 0;
    let remainingLines = 0;
    let totalLines = 0;
    if (step.toLowerCase() === 'files' && !state.build.mode) {
      const fallbackMode = resolveModeForFile(state.build.currentFile);
      if (fallbackMode) {
        state.build.mode = fallbackMode;
      }
    }
    if (step.toLowerCase() === 'files' && state.build.mode) {
      const mode = state.build.mode;
      totalLines = state.build.lineTotals[mode] || 0;
      const processedLines = state.build.linesProcessed[mode] || 0;
      if (elapsedMs > 0 && processedLines > 0) {
        lineRate = processedLines / (elapsedMs / 1000);
      }
      remainingLines = totalLines - processedLines;
      if (lineRate > 0 && remainingLines > 0) {
        etaMs = (remainingLines / lineRate) * 1000;
      }
    }
    const pctDelta = pct - state.build.lastPct;
    const countDelta = count - state.build.lastCount;
    const shouldLog =
      count === total
      || now - state.build.lastLoggedMs >= 5000
      || pctDelta >= 1
      || countDelta >= 500;
    if (shouldLog) {
      const rateText = rate > 0 ? `${rate.toFixed(1)}/s` : 'n/a';
      const lineRateText = lineRate > 0 ? `${Math.round(lineRate).toLocaleString()}/s` : null;
      const etaText = etaMs > 0 ? formatDuration(etaMs) : 'n/a';
      const labelText = label ? ` ${label}` : '';
      const lineRateSegment = lineRateText ? ` | lines ${lineRateText}` : '';
      const totalLinesText = totalLines > 0 ? `${formatLoc(totalLines)}` : null;
      const processedLinesText = totalLines > 0
        ? `${formatLoc(totalLines - remainingLines)}/${totalLinesText}`
        : null;
      const linesElapsedSegment = processedLinesText ? ` (${processedLinesText})` : '';
      const remainingLinesText = remainingLines > 0 ? formatLoc(remainingLines) : null;
      const etaSegment = remainingLinesText ? `${etaText} (${remainingLinesText} rem)` : etaText;
      const currentLineSegment = state.build.currentLineTotal > 0
        ? ` [${state.build.currentLine}/${state.build.currentLineTotal}]`
        : '';
      const message = `Indexing${labelText} ${step} ${count}/${total} (${pct.toFixed(1)}%)${currentLineSegment} | rate ${rateText}${lineRateSegment} | elapsed ${formatDuration(elapsedMs)}${linesElapsedSegment} | eta ${etaSegment}`;
      updateMetrics(message);
      state.build.lastLoggedMs = now;
      state.build.lastCount = count;
      state.build.lastPct = pct;
    }
    refreshProgressLine(now);
    return true;
  };

  const formatProgressLine = (line) => {
    const parsed = parseProgressLine(line);
    if (!parsed) return null;
    const { step, count, total, pct } = parsed;
    if (!Number.isFinite(count) || !Number.isFinite(total)) return null;
    const pctText = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : null;
    const lineText = `${step} ${count}/${total}${pctText ? ` (${pctText})` : ''}`;
    return {
      line: lineText,
      tag: `progress:${step.toLowerCase()}`
    };
  };

  const appendLog = (line) => {
    const cleaned = line.replace(/\r/g, '').trimEnd();
    if (!cleaned) return;
    if (handleImportStatsLine(cleaned)) {
      refreshProgressLine(Date.now(), true);
    }
    if (handleShardLine(cleaned)) {
      pushHistory(cleaned);
      if (interactive) {
        pushLogWindowLine(cleaned);
      } else if (!quietMode) {
        console.error(cleaned);
      }
      return;
    }
    if (parseLineProgress(cleaned)) {
      handleBuildLineProgress(cleaned);
      handleBuildProgress(cleaned);
      return;
    }
    const fileProgress = parseFileProgressLine(cleaned);
    if (fileProgress && fileProgress.file) {
      pushHistory(cleaned);
      handleBuildMode(cleaned);
      handleBuildFileLine(fileProgress);
      handleBuildLineProgress(cleaned);
      handleBuildProgress(cleaned);
      const formatted = formatShardFileProgress(fileProgress, {
        shardByLabel: state.shardByLabel,
        lineTotal: state.build.currentLineTotal
      });
      if (formatted) {
        if (interactive) {
          pushLogWindowLine(formatted);
        } else if (!quietMode) {
          console.error(formatted);
        }
      }
      return;
    }
    const formattedProgress = formatProgressLine(cleaned);
    if (formattedProgress) {
      const { line: formattedLine, tag } = formattedProgress;
      pushHistory(cleaned);
      handleBuildMode(cleaned);
      handleBuildLineProgress(cleaned);
      handleBuildProgress(cleaned);
      if (interactive) {
        pushLogWindowLine(formattedLine, { tag });
      } else if (!quietMode) {
        console.error(formattedLine);
      }
      return;
    }
    pushHistory(cleaned);
    writeLog(cleaned);
    handleBuildMode(cleaned);
    handleBuildFileLine(cleaned);
    handleBuildLineProgress(cleaned);
    handleBuildProgress(cleaned);
    if (interactive) {
      pushLogWindowLine(cleaned);
    } else if (!quietMode) {
      console.error(cleaned);
    }
  };

  const resetBuildProgress = (label = '') => {
    resetBuildProgressState(state, label);
    updateFileProgressLine();
  };

  return {
    appendLog,
    updateProgress,
    updateMetrics,
    updateFileProgressLine,
    resetBuildProgress,
    renderStatus
  };
};
