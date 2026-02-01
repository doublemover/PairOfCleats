import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  ANSI,
  TIME_LABEL_COLOR,
  applyLineBackground,
  buildBorder,
  colorize,
  colorizeBorder,
  formatDurationBadge,
  formatDurationValue,
  formatLabel,
  formatLogLine,
  formatLogPath,
  formatOutputLines,
  formatSkipReason,
  padEndRaw,
  padEndVisible,
  resolveSlowestColor,
  wrapList
} from './run-formatting.js';
import { buildOutputSnippet } from './run-logging.js';
import { formatFailure, summarizeResults } from './run-results.js';

export const createOrderedReporter = ({ size, onReport }) => {
  const results = new Array(size);
  let nextToReport = 0;
  const report = (result, index) => {
    results[index] = result;
    while (nextToReport < results.length && results[nextToReport]) {
      if (onReport) onReport(results[nextToReport], nextToReport);
      nextToReport += 1;
    }
  };
  return { results, report };
};

const formatInitLine = ({ context, entry }) => {
  const { consoleStream, useColor } = context;
  const label = formatLabel('INIT', { useColor, mode: 'init' });
  const gap = useColor ? `${ANSI.bgBlack} ${ANSI.reset}` : ' ';
  const elapsedMs = Date.now() - entry.startedAt;
  const duration = formatDurationBadge(elapsedMs, { useColor });
  const line = `${label}${gap}${duration} ${entry.test.id}`;
  return applyLineBackground(line, { useColor, columns: consoleStream.columns });
};

export const createInitReporter = ({ context }) => {
  const { consoleStream, useColor, captureOutput, argv } = context;
  const enabled = Boolean(
    useColor
    && consoleStream.isTTY
    && captureOutput
    && !argv.json
    && !argv.quiet
  );
  if (!enabled) return null;
  const active = new Map();
  let timer = null;
  let paused = false;
  let renderedLines = 0;
  let lastRenderedAt = 0;
  const clearBlock = () => {
    if (!renderedLines) return;
    consoleStream.write(`\x1b[${renderedLines}A`);
    consoleStream.write('\x1b[0J');
    renderedLines = 0;
  };
  const render = (force = false) => {
    if (paused) return;
    const now = Date.now();
    if (!force && now - lastRenderedAt < 500) return;
    clearBlock();
    if (!active.size) return;
    for (const entry of active.values()) {
      consoleStream.write(`${formatInitLine({ context, entry })}\n`);
      renderedLines += 1;
    }
    lastRenderedAt = now;
  };
  const startTimer = () => {
    if (timer) return;
    timer = setInterval(render, 100);
    if (typeof timer.unref === 'function') timer.unref();
  };
  const stopTimer = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };
  const withPaused = (callback) => {
    paused = true;
    clearBlock();
    try {
      callback();
    } finally {
      paused = false;
      if (active.size) {
        render();
      }
    }
  };
  const start = (test) => {
    active.set(test.id, { test, startedAt: Date.now() });
    startTimer();
    render(true);
  };
  const complete = (testId, callback) => {
    active.delete(testId);
    if (!active.size) stopTimer();
    withPaused(() => {
      callback();
      lastRenderedAt = Date.now();
    });
    return true;
  };
  return { start, complete, withPaused };
};

export const renderHeader = ({ context, lanesList, testsCount, jobs }) => {
  const { consoleStream, useColor, showPreamble } = context;
  const innerPadding = '      ';
  const headerIndent = '         ';
  const lineIndent = headerIndent + innerPadding;
  const prefix = 'Lanes: ';
  const testsRaw = `Tests: ${testsCount}`;
  const showJobs = jobs > 1;
  const jobsCount = String(jobs).padStart(2);
  const jobsRaw = `Jobs: ${jobsCount}`;
  const rightRaw = showJobs ? `${testsRaw} | ${jobsRaw}` : testsRaw;
  const rightRawWithPipe = `| ${rightRaw}`;
  const maxWidth = Math.max(
    60,
    Math.min((consoleStream.isTTY && consoleStream.columns ? consoleStream.columns : 80) - headerIndent.length, 120)
  );
  const laneMaxLen = Math.max(10, maxWidth - prefix.length - 1 - rightRawWithPipe.length);
  const laneLines = wrapList(lanesList, laneMaxLen);
  const laneLineTexts = laneLines.map((line, idx) => {
    const text = line.join(', ');
    return idx < laneLines.length - 1 ? `${text},` : text;
  });
  const maxLaneLineLen = laneLineTexts.reduce((max, text) => Math.max(max, text.length), 0);
  const leftWidth = prefix.length + maxLaneLineLen;
  const rightPipe = useColor ? `${ANSI.fgLight}|${ANSI.reset}` : '|';

  const lanesLabel = colorize('Lanes:', ANSI.fgLightBlue, useColor);
  const lanesLineColored = laneLines.map((line, idx) => {
    const colored = line.map((lane) => colorize(lane, ANSI.fgLight, useColor)).join(', ');
    return idx < laneLines.length - 1 ? `${colored},` : colored;
  });
  const testsLabel = colorize('Tests:', ANSI.fgGreen, useColor);
  const testsValue = colorize(testsCount, ANSI.fgLight, useColor);
  const jobsLabel = colorize('Jobs:', ANSI.fgOrange, useColor);
  const jobsValue = colorize(jobsCount, ANSI.fgLight, useColor);
  const rightColored = showJobs
    ? `${rightPipe} ${testsLabel} ${testsValue} ${rightPipe} ${jobsLabel} ${jobsValue}`
    : `${rightPipe} ${testsLabel} ${testsValue}`;

  const contentLinesRaw = [];
  const contentLinesColored = [];

  if (laneLineTexts.length) {
    const leftRaw = padEndRaw(`${prefix}${laneLineTexts[0]}`, leftWidth);
    const leftColored = padEndVisible(`${lanesLabel} ${lanesLineColored[0]}`, leftWidth);
    contentLinesRaw.push(`${leftRaw} ${rightRawWithPipe}`);
    contentLinesColored.push(`${leftColored} ${rightColored}`);
    for (let i = 1; i < laneLineTexts.length; i += 1) {
      const leftRawLine = padEndRaw(laneLineTexts[i], maxLaneLineLen);
      const leftColoredLine = padEndVisible(lanesLineColored[i], maxLaneLineLen);
      contentLinesRaw.push(`${' '.repeat(prefix.length)}${leftRawLine}${rightRawWithPipe.slice(0, 1)}`);
      contentLinesColored.push(`${' '.repeat(prefix.length)}${leftColoredLine}${rightPipe}`);
    }
  }

  const contentWidth = contentLinesRaw.reduce((max, line) => Math.max(max, line.length), 0);
  const maxContentLength = Math.max(contentWidth, context.borderPattern.length);
  const paddedLinesColored = contentLinesColored.map((line) => padEndVisible(line, maxContentLength));
  const borderRaw = buildBorder(context.borderPattern, maxContentLength);
  const border = `${headerIndent}${colorizeBorder(borderRaw, useColor)}`;
  const headerBg = { useColor, columns: consoleStream.columns };
  const blankLine = applyLineBackground('', headerBg);

  if (showPreamble) {
    consoleStream.write(`${blankLine}\n`);
    consoleStream.write(`${applyLineBackground(border, headerBg)}\n`);
    for (const line of paddedLinesColored) {
      consoleStream.write(`${applyLineBackground(`${lineIndent}${line}`, headerBg)}\n`);
    }
    consoleStream.write(`${applyLineBackground(border, headerBg)}\n`);
    consoleStream.write(`${blankLine}\n`);
  }

  return { border, innerPadding };
};

const renderCapturedOutput = ({ context, result, mode }) => {
  const { consoleStream, useColor, outputIgnorePatterns } = context;
  const lines = buildOutputSnippet({
    stdout: result.stdout,
    stderr: result.stderr,
    mode,
    ignorePatterns: outputIgnorePatterns
  });
  const output = formatOutputLines(lines, { useColor, columns: consoleStream.columns });
  if (!output) return;
  consoleStream.write(output);
  consoleStream.write(`${applyLineBackground('', { useColor, columns: consoleStream.columns })}\n`);
};

export const reportTestResult = ({ context, result }) => {
  const { consoleStream, useColor, showFailures, showPass, showSkip, captureOutput, root } = context;
  const initReporter = context.initReporter;
  if (result.timedOut && showFailures) {
    const duration = formatDurationBadge(result.durationMs, {
      useColor,
      bg: ANSI.bgFailLine,
      bracketColor: ANSI.fgTimeoutUnit,
      numberColor: ANSI.fgOrange,
      decimalColor: ANSI.fgBrightWhite,
      unitColor: ANSI.fgTimeoutUnit
    });
    const label = formatLabel('TIME', { useColor, mode: 'timeout' });
    const gap = useColor ? `${ANSI.bgFailLine} ${ANSI.reset}` : ' ';
    const timeoutLine = `${label}${gap}${duration} ${result.id} - timeout`;
    const render = () => {
      consoleStream.write(`${applyLineBackground(timeoutLine, {
        useColor,
        columns: consoleStream.columns,
        bg: ANSI.bgFailLine
      })}\n`);
      let wroteLog = false;
      if (result.logs && result.logs.length) {
        const logLine = formatLogLine(result.logs[result.logs.length - 1], { useColor, root });
        consoleStream.write(`${applyLineBackground(logLine, {
          useColor,
          columns: consoleStream.columns,
          bg: ANSI.bgLogLine
        })}\n`);
        wroteLog = true;
      }
      if (captureOutput && !context.argv.json) {
        renderCapturedOutput({ context, result, mode: 'failure' });
      } else if (wroteLog) {
        consoleStream.write(`${applyLineBackground('', { useColor, columns: consoleStream.columns })}\n`);
      }
    };
    if (initReporter) {
      initReporter.complete(result.id, render);
    } else {
      render();
    }
  } else if (result.status === 'failed' && showFailures) {
    const duration = formatDurationBadge(result.durationMs, { useColor, bg: ANSI.bgFailLine });
    const detail = formatFailure(result);
    const attemptInfo = result.attempts > 1 ? ` after ${result.attempts} attempts` : '';
    const label = formatLabel('FAIL', { useColor, mode: 'fail' });
    const gap = useColor ? `${ANSI.bgFailLine} ${ANSI.reset}` : ' ';
    const failLine = `${label}${gap}${duration} ${result.id} ${detail}${attemptInfo}`;
    const render = () => {
      consoleStream.write(`${applyLineBackground(failLine, {
        useColor,
        columns: consoleStream.columns,
        bg: ANSI.bgFailLine
      })}\n`);
      let wroteLog = false;
      if (result.logs && result.logs.length) {
        const logLine = formatLogLine(result.logs[result.logs.length - 1], { useColor, root });
        consoleStream.write(`${applyLineBackground(logLine, {
          useColor,
          columns: consoleStream.columns,
          bg: ANSI.bgLogLine
        })}\n`);
        wroteLog = true;
      }
      if (captureOutput && !context.argv.json) {
        renderCapturedOutput({ context, result, mode: 'failure' });
      } else if (wroteLog) {
        consoleStream.write(`${applyLineBackground('', { useColor, columns: consoleStream.columns })}\n`);
      }
    };
    if (initReporter) {
      initReporter.complete(result.id, render);
    } else {
      render();
    }
  } else if (result.status === 'passed' && showPass) {
    const duration = formatDurationBadge(result.durationMs, { useColor });
    const label = formatLabel('PASS', { useColor, mode: 'pass' });
    const gap = useColor ? `${ANSI.bgBlack} ${ANSI.reset}` : ' ';
    const passLine = `${label}${gap}${duration} ${result.id}`;
    const render = () => {
      consoleStream.write(`${applyLineBackground(passLine, { useColor, columns: consoleStream.columns })}\n`);
      if (captureOutput && !context.argv.json) {
        renderCapturedOutput({ context, result, mode: 'success' });
      }
    };
    if (initReporter) {
      initReporter.complete(result.id, render);
    } else {
      render();
    }
  } else if (result.status === 'skipped' && showSkip) {
    const reason = formatSkipReason(result.skipReason, { useColor });
    const label = formatLabel('SKIP', { useColor, mode: 'skip' });
    const gap = useColor ? `${ANSI.bgBlack} ${ANSI.reset}` : ' ';
    const pad = ' '.repeat(10);
    const nameText = useColor ? `${ANSI.fgDarkGray}${result.id}${ANSI.reset}` : result.id;
    const skipLine = `${label}${gap}${pad}${nameText}${reason}`;
    const render = () => {
      consoleStream.write(`${applyLineBackground(skipLine, { useColor, columns: consoleStream.columns })}\n`);
    };
    if (initReporter) {
      initReporter.complete(result.id, render);
    } else {
      render();
    }
  }
};

export const renderSummary = ({ context, summary, results, runLogDir, border, innerPadding }) => {
  const { consoleStream, useColor, outputIgnorePatterns, root } = context;
  const summaryBg = { useColor, columns: consoleStream.columns };
  const summaryIndent = '     ' + '        ' + innerPadding;
  const sectionIndent = '  ';
  const itemIndent = '     ';
  const completeIndent = '                        ' + '        ' + innerPadding;
  const summaryLabelName = 'Summary';
  const durationLabelName = 'Duration';
  const slowestLabelName = 'Slowest';
  const labelWidth = Math.max(summaryLabelName.length, durationLabelName.length, slowestLabelName.length);
  const renderLabel = (label, color) => {
    const padded = label.padEnd(labelWidth);
    if (!useColor) return `${padded}:`;
    return `${color}${padded}:${ANSI.reset}`;
  };
  const resolveWord = (count, singular, plural) => (count === 1 ? singular : plural);
  const collapseDuplicateLines = (lines) => {
    if (!lines.length) return lines;
    const counts = new Map();
    const order = [];
    for (const line of lines) {
      if (!counts.has(line)) order.push(line);
      counts.set(line, (counts.get(line) || 0) + 1);
    }
    return order.map((line) => {
      const count = counts.get(line) || 1;
      if (count <= 1) return line;
      const repeated = `${count}x ${line}`;
      if (!useColor) return repeated;
      return `${ANSI.dim}${ANSI.fgDarkGray}${repeated}${ANSI.reset}`;
    });
  };

  const passedText = colorize('Passed', ANSI.fgGreen, useColor);
  const passedValue = colorize(String(summary.passed), ANSI.fgBrightWhite, useColor);
  const timeouts = results.filter((result) => result.timedOut);
  const failedOnly = results.filter((result) => result.status === 'failed' && !result.timedOut);
  const excludedSkips = results.filter((result) => result.status === 'skipped'
    && String(result.skipReason || '').toLowerCase().startsWith('excluded tag:'));
  const skippedOnly = results.filter((result) => result.status === 'skipped'
    && !String(result.skipReason || '').toLowerCase().startsWith('excluded tag:'));
  const failedValue = colorize(String(failedOnly.length), ANSI.fgBrightWhite, useColor);
  const skippedValue = colorize(String(skippedOnly.length), ANSI.fgBrightWhite, useColor);
  const timeoutsValue = colorize(String(timeouts.length), ANSI.fgBrightWhite, useColor);
  const summaryFailedWord = resolveWord(failedOnly.length, 'Failure', 'Failed');
  const summaryTimeoutWord = resolveWord(timeouts.length, 'Timeout', 'Timeouts');
  const summarySkipWord = resolveWord(skippedOnly.length, 'Skip', 'Skipped');

  consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
  const completeText = useColor
    ? `${ANSI.bold}${ANSI.fgBrightWhite}Test Complete!${ANSI.reset}`
    : 'Test Complete!';
  consoleStream.write(`${applyLineBackground(`${completeIndent}${completeText}`, summaryBg)}\n`);
  consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
  consoleStream.write(`${applyLineBackground(border, summaryBg)}\n`);
  const summaryLine = `${summaryIndent}${renderLabel(summaryLabelName, ANSI.fgLightBlue)} ${passedValue} ${passedText} | ` +
    `${failedValue} ${colorize(summaryFailedWord, ANSI.fgRed, useColor)} | ` +
    `${timeoutsValue} ${colorize(summaryTimeoutWord, ANSI.fgOrange, useColor)} | ` +
    `${skippedValue} ${colorize(summarySkipWord, ANSI.fgPink, useColor)}`;
  consoleStream.write(`${applyLineBackground(summaryLine, summaryBg)}\n`);
  const durationLine = `${summaryIndent}${renderLabel(durationLabelName, TIME_LABEL_COLOR)} ${formatDurationValue(summary.durationMs, { useColor })}`;
  consoleStream.write(`${applyLineBackground(durationLine, summaryBg)}\n`);
  const slowest = results.reduce((best, result) => {
    if (!Number.isFinite(result?.durationMs)) return best;
    if (!best || result.durationMs > best.durationMs) return result;
    return best;
  }, null);
  if (slowest) {
    const slowestColor = resolveSlowestColor(slowest.durationMs);
    const slowestLabel = useColor
      ? `${slowestColor}${slowestLabelName.padEnd(labelWidth)}:${ANSI.reset}`
      : `${slowestLabelName.padEnd(labelWidth)}:`;
    if (timeouts.length > 1 || slowest.timedOut) {
      const timeoutCount = timeouts.length || 1;
      const timeoutWord = timeoutCount === 1 ? 'Test' : 'Tests';
      const baseText = `${timeoutCount} ${timeoutWord} Timed Out`;
      const thresholds = [2, 5, 10, 15, 20, 25, 50, 100];
      const extraMarks = thresholds.reduce((count, value) => (timeoutCount >= value ? count + 1 : count), 0);
      const marks = extraMarks ? '!'.repeat(extraMarks) : '';
      const message = `${baseText}${marks}`;
      const slowestLine = `${summaryIndent}${slowestLabel} ${colorize(message, ANSI.fgBrightWhite, useColor)}`;
      consoleStream.write(`${applyLineBackground(slowestLine, summaryBg)}\n`);
    } else {
      const slowestName = colorize(slowest.id, ANSI.fgBrightWhite, useColor);
      const slowestStatus = slowest.status === 'passed'
        ? colorize('PASS', ANSI.fgGreen, useColor)
        : (slowest.status === 'skipped'
          ? colorize('SKIP', ANSI.fgPink, useColor)
          : colorize('FAIL', ANSI.fgRed, useColor));
      const slowestTime = formatDurationBadge(slowest.durationMs, { useColor });
      const slowestLine = `${summaryIndent}${slowestLabel} ${slowestName} | ${slowestStatus} ${slowestTime}`;
      consoleStream.write(`${applyLineBackground(slowestLine, summaryBg)}\n`);
    }
  }
  consoleStream.write(`${applyLineBackground(border, summaryBg)}\n`);
  consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
  if (excludedSkips.length) {
    const exclusions = new Set();
    for (const skip of excludedSkips) {
      const reason = String(skip.skipReason || '');
      const raw = reason.replace(/^excluded tag:/i, '').trim();
      if (!raw) continue;
      raw.split(',').map((value) => value.trim()).filter(Boolean).forEach((tag) => exclusions.add(tag));
    }
    const exclusionCount = exclusions.size;
    const testsCount = excludedSkips.length;
    const labelText = useColor
      ? `${ANSI.fgPinkDark}Excluded Tags${ANSI.reset}`
      : 'Excluded Tags';
    const exclusionValue = useColor ? `${ANSI.fgBrightWhite}${exclusionCount}${ANSI.reset}` : String(exclusionCount);
    const testsValue = useColor ? `${ANSI.fgBrightWhite}${testsCount}${ANSI.reset}` : String(testsCount);
    const headerLine = `${sectionIndent}${labelText} - ${exclusionValue} Exclusions bypassing ${testsValue} Tests`;
    consoleStream.write(`${applyLineBackground(headerLine, summaryBg)}\n`);
    const tagsList = Array.from(exclusions).sort((a, b) => a.localeCompare(b));
    if (tagsList.length) {
      const maxWidth = Math.max(20, (consoleStream.columns || 100) - sectionIndent.length - 2);
      const wrapped = wrapList(tagsList, maxWidth);
      for (const lineItems of wrapped) {
        const lineText = lineItems.join(', ');
        const coloredText = useColor
          ? lineItems.map((tag) => `${ANSI.fgPinkDark}${tag}${ANSI.reset}`).join(`${ANSI.fgBrightWhite}, ${ANSI.reset}`)
          : lineText;
        consoleStream.write(`${applyLineBackground(`${itemIndent}${coloredText}`, summaryBg)}\n`);
      }
    }
    consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
  }
  if (skippedOnly.length) {
    const skipHeaderText = resolveWord(skippedOnly.length, 'Skip', 'Skips');
    const skipHeader = useColor
      ? `${sectionIndent}${ANSI.fgPink}${skipHeaderText}${ANSI.reset}${ANSI.fgBrightWhite}:${ANSI.reset}`
      : `${sectionIndent}${skipHeaderText}:`;
    consoleStream.write(`${applyLineBackground(skipHeader, summaryBg)}\n`);
    for (const skip of skippedOnly) {
      const reason = skip.skipReason ? ` (${skip.skipReason})` : '';
      const bullet = useColor ? `${ANSI.fgBrightWhite}- ${ANSI.reset}` : '- ';
      const lineText = `${itemIndent}${bullet}${skip.id}${reason}`;
      const coloredLine = useColor ? `${ANSI.fgBrightWhite}${lineText}${ANSI.reset}` : lineText;
      consoleStream.write(`${applyLineBackground(coloredLine, summaryBg)}\n`);
    }
    consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
  }
  if (timeouts.length) {
    const timeoutHeaderText = resolveWord(timeouts.length, 'Timeout', 'Timeouts');
    const timeoutHeader = useColor
      ? `${sectionIndent}${ANSI.fgOrange}${timeoutHeaderText}${ANSI.reset}${ANSI.fgBrightWhite}:${ANSI.reset}`
      : `${sectionIndent}${timeoutHeaderText}:`;
    consoleStream.write(`${applyLineBackground(timeoutHeader, summaryBg)}\n`);
    for (const timeout of timeouts) {
      const bullet = useColor ? `${ANSI.fgBrightWhite}- ${ANSI.reset}` : '- ';
      const timeoutLine = `${itemIndent}${bullet}${timeout.id} ${formatDurationBadge(timeout.durationMs, { useColor })}`;
      const coloredLine = useColor ? `${ANSI.fgDarkOrange}${timeoutLine}${ANSI.reset}` : timeoutLine;
      consoleStream.write(`${applyLineBackground(coloredLine, summaryBg)}\n`);
    }
    consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
  }
  if (failedOnly.length) {
    const includeFailureDetails = failedOnly.length <= 7;
    const failureHeaderText = resolveWord(failedOnly.length, 'Failure', 'Failures');
    const failureHeader = useColor
      ? `${sectionIndent}${ANSI.fgRed}${failureHeaderText}${ANSI.reset}${ANSI.fgBrightWhite}:${ANSI.reset}`
      : `${sectionIndent}${failureHeaderText}:`;
    consoleStream.write(`${applyLineBackground(failureHeader, summaryBg)}\n`);
    for (const failure of failedOnly) {
      const detail = formatFailure(failure);
      const detailText = useColor
        ? `${ANSI.bold}${ANSI.fgBrightWhite}${detail}${ANSI.reset}`
        : detail;
      const bullet = useColor ? `${ANSI.fgBrightWhite}- ${ANSI.reset}` : '- ';
      const nameText = useColor ? `${ANSI.fgRed}${failure.id}${ANSI.reset}` : failure.id;
      const duration = formatDurationBadge(failure.durationMs, { useColor });
      const lineText = `${itemIndent}${bullet}${duration} ${nameText} (${detailText})`;
      consoleStream.write(`${applyLineBackground(lineText, summaryBg)}\n`);
      if (includeFailureDetails) {
        const outputLines = buildOutputSnippet({
          stdout: failure.stdout,
          stderr: failure.stderr,
          mode: 'failure',
          ignorePatterns: outputIgnorePatterns
        });
        const hasLogs = failure.logs && failure.logs.length;
        const hasDetails = outputLines.length || hasLogs;
        if (outputLines.length) {
          const dedupedLines = collapseDuplicateLines(outputLines);
          const subIndent = `${itemIndent}    `;
          for (const line of dedupedLines) {
            const subLine = `${subIndent}${line}`;
            const coloredSubLine = useColor ? `${ANSI.fgDarkGray}${subLine}${ANSI.reset}` : subLine;
            consoleStream.write(`${applyLineBackground(coloredSubLine, summaryBg)}\n`);
          }
        }
        if (hasLogs) {
          const subIndent = `${itemIndent}    `;
          const logPath = formatLogPath(failure.logs[failure.logs.length - 1], root);
          const logLine = `${subIndent}LOG: ${logPath}`;
          const coloredLogLine = useColor ? `${ANSI.fgDarkGray}${logLine}${ANSI.reset}` : logLine;
          consoleStream.write(`${applyLineBackground(coloredLogLine, summaryBg)}\n`);
        }
        if (hasDetails) {
          consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
        }
      }
    }
    consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
  }
  if (runLogDir) {
    const logsLine = `  ${formatLabel('LOGS:', { useColor, mode: 'log' })} ${formatLogPath(runLogDir, root)}`;
    consoleStream.write(`${applyLineBackground(logsLine, summaryBg)}\n`);
  }
  consoleStream.write(`${applyLineBackground(border, summaryBg)}\n`);
};

export const buildJsonReport = ({ summary, results, root, runLogDir, junitPath }) => ({
  summary,
  logDir: runLogDir || null,
  junit: junitPath ? path.resolve(root, junitPath) : null,
  tests: results.map((result) => ({
    id: result.id,
    path: result.relPath,
    lane: result.lane,
    tags: result.tags,
    status: result.status,
    durationMs: result.durationMs,
    attempts: result.attempts,
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    timedOut: result.timedOut ?? false,
    skipReason: result.skipReason || null,
    termination: result.termination || null,
    logs: result.logs || []
  }))
});

export const writeJUnit = async ({ junitPath, results, totalMs }) => {
  if (!junitPath) return;
  await fsPromises.mkdir(path.dirname(junitPath), { recursive: true });
  const escapeXml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/\'/g, '&apos;');
  const durationSeconds = (totalMs / 1000).toFixed(3);
  const summary = summarizeResults(results, totalMs);
  const cases = results.map((result) => {
    const time = ((result.durationMs || 0) / 1000).toFixed(3);
    const name = escapeXml(result.id);
    if (result.status === 'passed') {
      return `  <testcase classname="pairofcleats" name="${name}" time="${time}"/>`;
    }
    if (result.status === 'skipped') {
      const skipMessage = result.skipReason ? ` message="${escapeXml(result.skipReason)}"` : '';
      return `  <testcase classname="pairofcleats" name="${name}" time="${time}"><skipped${skipMessage}/></testcase>`;
    }
    const message = escapeXml(formatFailure(result));
    return `  <testcase classname="pairofcleats" name="${name}" time="${time}"><failure message="${message}"/></testcase>`;
  });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="pairofcleats" tests="${summary.total}" failures="${summary.failed}" skipped="${summary.skipped}" time="${durationSeconds}">`,
    ...cases,
    '</testsuite>',
    ''
  ].join('\n');
  await fsPromises.writeFile(junitPath, xml, 'utf8');
};

export const writeTimings = async ({ timingsPath, results, totalMs, runId }) => {
  if (!timingsPath) return;
  await fsPromises.mkdir(path.dirname(timingsPath), { recursive: true });
  const payload = {
    runId,
    totalMs,
    tests: results.map((result) => ({
      id: result.id,
      lane: result.lane,
      status: result.status,
      durationMs: result.durationMs
    }))
  };
  await fsPromises.writeFile(timingsPath, `${JSON.stringify(payload)}\n`, 'utf8');
};

export const writeLatestLogPointer = async ({ root, runLogDir }) => {
  if (!runLogDir) return;
  const latestPath = path.join(root, '.testLogs', 'latest');
  await fsPromises.mkdir(path.dirname(latestPath), { recursive: true });
  const relative = formatLogPath(runLogDir, root);
  await fsPromises.writeFile(latestPath, `${relative}\n`, 'utf8');
};
