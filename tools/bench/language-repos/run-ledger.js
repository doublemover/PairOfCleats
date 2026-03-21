import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { createQueuedAppendWriter } from '../../../src/shared/io/append-writer.js';
import { createTimeoutError, runWithTimeout } from '../../../src/shared/promise-timeout.js';
import { evaluateBenchVerdict, loadBenchPolicy } from '../language/verdict.js';

export const BENCH_RUN_LEDGER_SCHEMA_VERSION = 1;
export const BENCH_RUN_SUMMARY_SCHEMA_VERSION = 1;
export const BENCH_RUN_LEDGER_EVENT_VERSION = 1;

const DEFAULT_LEDGER_CLOSE_TIMEOUT_MS = 5000;
const DEFAULT_LEDGER_FLUSH_INTERVAL_MS = 2000;
const RETAINED_CRASH_BUNDLE_NAME = 'retained-crash-bundle.json';

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toText = (value) => {
  const text = String(value == null ? '' : value).trim();
  return text || null;
};

const sortObjectKeys = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => String(left).localeCompare(String(right)))
  );
};

const buildRepoKey = (entry) => {
  const language = toText(entry?.language) || '_unknown';
  const tier = toText(entry?.tier) || '_unknown';
  const repo = toText(entry?.repo) || '_unknown';
  return `${language}:${tier}:${repo}`;
};

const normalizeCountsByType = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [key, count] of Object.entries(value)) {
    const numeric = Number(count);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    out[key] = numeric;
  }
  const sorted = sortObjectKeys(out);
  return Object.keys(sorted || {}).length ? sorted : null;
};

const normalizeCrashRetention = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const bundlePath = toText(value.bundlePath);
  if (!bundlePath) return null;
  return {
    bundlePath,
    markerPath: toText(value.markerPath),
    diagnosticsDir: toText(value.diagnosticsDir),
    checksum: toText(value.checksum)
  };
};

const normalizeTaskEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const payload = {
    language: toText(entry.language),
    tier: toText(entry.tier),
    repo: toText(entry.repo),
    repoPath: toText(entry.repoPath),
    outFile: toText(entry.outFile),
    failed: entry.failed === true,
    skipped: entry.skipped === true,
    skipReason: toText(entry.skipReason),
    failureReason: toText(entry.failureReason),
    failureCode: Number.isFinite(Number(entry.failureCode)) ? Number(entry.failureCode) : null,
    failureSignal: toText(entry.failureSignal || entry.signal),
    timeoutKind: toText(entry.timeoutKind),
    lastActivity: entry?.lastActivity && typeof entry.lastActivity === 'object'
      ? {
        source: toText(entry.lastActivity.source),
        ageMs: Number.isFinite(Number(entry.lastActivity.ageMs)) ? Number(entry.lastActivity.ageMs) : null,
        text: toText(entry.lastActivity.text)
      }
      : null,
    diagnostics: {
      process: entry?.diagnostics?.process && typeof entry.diagnostics.process === 'object'
        ? {
          countsByType: normalizeCountsByType(entry.diagnostics.process.countsByType),
          eventCount: Number.isFinite(Number(entry.diagnostics.process.eventCount))
            ? Number(entry.diagnostics.process.eventCount)
            : null
        }
        : null,
      countsByType: normalizeCountsByType(entry?.diagnostics?.countsByType),
      progressConfidence: entry?.diagnostics?.progressConfidence && typeof entry.diagnostics.progressConfidence === 'object'
        ? {
          bucket: toText(entry.diagnostics.progressConfidence.bucket),
          ratio: Number.isFinite(Number(entry.diagnostics.progressConfidence.ratio))
            ? Number(entry.diagnostics.progressConfidence.ratio)
            : null
        }
        : null,
      crashRetention: normalizeCrashRetention(
        entry?.diagnostics?.crashRetention || entry?.crashRetention || null
      )
    }
  };
  return payload;
};

const collectRetainedCrashBundles = async (diagnosticsRoot) => {
  const resolvedRoot = toText(diagnosticsRoot);
  if (!resolvedRoot || !fs.existsSync(resolvedRoot)) return [];
  const found = [];
  const walk = async (current) => {
    const entries = await fsPromises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(target);
        continue;
      }
      if (entry.isFile() && entry.name === RETAINED_CRASH_BUNDLE_NAME) {
        found.push(target);
      }
    }
  };
  await walk(resolvedRoot);
  found.sort((left, right) => left.localeCompare(right));
  return found;
};

export const readBenchRunLedger = async (ledgerPath) => {
  if (!ledgerPath || !fs.existsSync(ledgerPath)) return [];
  const raw = await fsPromises.readFile(ledgerPath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

const buildRunState = ({ endEvent, repoEntries, plannedCount }) => {
  const finishedCount = repoEntries.length;
  const plannedRepoCount = Number.isFinite(Number(plannedCount)) ? Number(plannedCount) : finishedCount;
  const unfinishedCount = Math.max(0, plannedRepoCount - finishedCount);
  const payload = endEvent?.payload && typeof endEvent.payload === 'object'
    ? endEvent.payload
    : {};
  const state = toText(payload.state) || 'unknown';
  return {
    state,
    reason: toText(payload.reason),
    signal: toText(payload.signal),
    exitCode: Number.isFinite(Number(payload.exitCode)) ? Number(payload.exitCode) : null,
    startedAt: toText(payload.runStartedAt),
    endedAt: toText(endEvent?.ts),
    plannedRepoCount,
    finishedRepoCount: finishedCount,
    unfinishedRepoCount: unfinishedCount
  };
};

const buildParities = ({
  repoEntries,
  retainedBundleEvents,
  retainedBundlePaths,
  output
}) => {
  const ledgerCrashPaths = new Set(
    retainedBundleEvents
      .map((entry) => toText(entry?.bundlePath || entry?.payload?.bundlePath))
      .filter(Boolean)
  );
  for (const entry of repoEntries) {
    const bundlePath = toText(entry?.diagnostics?.crashRetention?.bundlePath);
    if (bundlePath) ledgerCrashPaths.add(bundlePath);
  }
  const directoryCrashPaths = new Set(retainedBundlePaths.filter(Boolean));
  const outputCrashPaths = new Set(
    Array.isArray(output?.diagnostics?.crashRetention?.retained)
      ? output.diagnostics.crashRetention.retained
        .map((entry) => toText(entry?.bundlePath))
        .filter(Boolean)
      : []
  );
  const missingOnDisk = Array.from(ledgerCrashPaths).filter((entry) => !directoryCrashPaths.has(entry));
  const missingInLedger = Array.from(directoryCrashPaths).filter((entry) => !ledgerCrashPaths.has(entry));
  const missingInOutput = Array.from(ledgerCrashPaths).filter((entry) => output && !outputCrashPaths.has(entry));
  return {
    crashRetention: {
      ledgerCount: ledgerCrashPaths.size,
      directoryCount: directoryCrashPaths.size,
      outputCount: output ? outputCrashPaths.size : null,
      ok: missingOnDisk.length === 0
        && missingInLedger.length === 0
        && (!output || missingInOutput.length === 0),
      missingOnDisk,
      missingInLedger,
      missingInOutput
    }
  };
};

export const buildBenchRunSummaryFromLedgerEvents = async ({
  events,
  diagnosticsRoot = null,
  policy = null,
  output = null,
  runSuffix = null,
  logPaths = null
} = {}) => {
  const rows = Array.isArray(events) ? events.filter((entry) => entry && typeof entry === 'object') : [];
  const startEvent = rows.find((entry) => entry.eventType === 'run.started') || null;
  const endEvent = [...rows].reverse().find((entry) => entry.eventType === 'run.ended') || null;
  const repoStarted = rows.filter((entry) => entry.eventType === 'repo.started');
  const repoCompleted = rows
    .filter((entry) => entry.eventType === 'repo.completed')
    .map((entry) => normalizeTaskEntry(entry.payload?.result))
    .filter(Boolean);
  const retainedBundleEvents = rows
    .filter((entry) => entry.eventType === 'repo.crash_retained')
    .map((entry) => entry.payload || {});
  const retainedBundlePaths = await collectRetainedCrashBundles(diagnosticsRoot);
  const effectivePolicy = policy || await loadBenchPolicy({
    waiverFile: toText(startEvent?.payload?.waiverFile)
  });
  const verdict = evaluateBenchVerdict({
    tasks: repoCompleted,
    policy: effectivePolicy
  });
  const plannedCount = Number(startEvent?.payload?.plannedRepoCount || 0);
  const startedRepoKeys = new Map(
    repoStarted.map((entry) => [buildRepoKey(entry.payload), entry.payload || {}])
  );
  const completedRepoKeys = new Set(repoCompleted.map((entry) => buildRepoKey(entry)));
  const unfinishedRepos = Array.from(startedRepoKeys.entries())
    .filter(([key]) => !completedRepoKeys.has(key))
    .map(([, entry]) => ({
      language: toText(entry.language),
      tier: toText(entry.tier),
      repo: toText(entry.repo),
      repoPath: toText(entry.repoPath)
    }))
    .sort((left, right) => buildRepoKey(left).localeCompare(buildRepoKey(right)));
  const run = buildRunState({
    endEvent,
    repoEntries: repoCompleted,
    plannedCount: plannedCount || startEvent?.payload?.taskCount || 0
  });
  const parities = buildParities({
    repoEntries: repoCompleted,
    retainedBundleEvents,
    retainedBundlePaths,
    output
  });
  return {
    schemaVersion: BENCH_RUN_SUMMARY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runSuffix: toText(runSuffix || startEvent?.payload?.runSuffix),
    run,
    verdict: output?.run || verdict.run,
    counts: {
      planned: run.plannedRepoCount,
      started: repoStarted.length,
      finished: repoCompleted.length,
      unfinished: unfinishedRepos.length
    },
    unfinishedRepos,
    parities,
    paths: {
      masterLogPath: toText(logPaths?.masterLogPath || startEvent?.payload?.masterLogPath),
      footerPath: toText(logPaths?.footerPath || startEvent?.payload?.footerPath),
      ledgerPath: toText(logPaths?.ledgerPath || startEvent?.payload?.ledgerPath),
      summaryPath: toText(logPaths?.summaryPath || startEvent?.payload?.summaryPath),
      diagnosticsRoot: toText(diagnosticsRoot || startEvent?.payload?.diagnosticsRoot)
    },
    closeout: {
      eventCount: rows.length,
      closeoutStarted: rows.some((entry) => entry.eventType === 'closeout.started'),
      closeoutSummaryWritten: rows.some((entry) => entry.eventType === 'closeout.summary_written'),
      closeoutFooterWritten: rows.some((entry) => entry.eventType === 'closeout.footer_written'),
      closeoutFailures: rows
        .filter((entry) => entry.eventType === 'closeout.failed')
        .map((entry) => ({
          stage: toText(entry.payload?.stage),
          message: toText(entry.payload?.message)
        }))
    }
  };
};

export const formatBenchRunFooter = (summary) => {
  const lines = [];
  const generatedAt = toText(summary?.generatedAt) || new Date().toISOString();
  const state = toText(summary?.run?.state) || 'unknown';
  const verdict = toText(summary?.verdict?.aggregateResultClass) || 'unknown';
  const unwaived = Number(summary?.verdict?.issues?.unwaivedCount || 0);
  const waived = Number(summary?.verdict?.issues?.waivedCount || 0);
  const planned = Number(summary?.counts?.planned || 0);
  const finished = Number(summary?.counts?.finished || 0);
  const unfinished = Number(summary?.counts?.unfinished || 0);
  const crashParity = summary?.parities?.crashRetention || {};
  lines.push(`=== Bench closeout ${generatedAt} ===`);
  lines.push(`State: ${state}`);
  lines.push(`Repos: planned ${planned} | finished ${finished} | unfinished ${unfinished}`);
  lines.push(`Verdict: ${verdict} (unwaived=${unwaived} waived=${waived})`);
  lines.push(
    `Crash retention parity: ledger ${Number(crashParity.ledgerCount || 0)} | `
      + `directory ${Number(crashParity.directoryCount || 0)}`
      + `${crashParity.outputCount == null ? '' : ` | output ${Number(crashParity.outputCount || 0)}`}`
      + ` | ${crashParity.ok === false ? 'mismatch' : 'ok'}`
  );
  if (summary?.paths?.summaryPath) {
    lines.push(`Run summary: ${summary.paths.summaryPath}`);
  }
  if (summary?.paths?.ledgerPath) {
    lines.push(`Run ledger: ${summary.paths.ledgerPath}`);
  }
  return lines;
};

export const createBenchRunLedger = ({
  logsRoot,
  runSuffix,
  diagnosticsRoot,
  configPath,
  reposRoot,
  cacheRoot,
  resultsRoot,
  masterLogPath,
  waiverFile,
  methodology
}) => {
  const ledgerPath = path.join(logsRoot, `${runSuffix}-run-ledger.jsonl`);
  const summaryPath = path.join(logsRoot, `${runSuffix}-run-summary.json`);
  const footerPath = path.join(logsRoot, `${runSuffix}-footer.log`);
  let writer = null;
  let flushTimer = null;
  const pendingSyncWrites = [];

  const ensureWriter = () => {
    if (writer) return writer;
    fs.mkdirSync(logsRoot, { recursive: true });
    writer = createQueuedAppendWriter({
      filePath: ledgerPath,
      ensureDir: true,
      syncOnFlush: false
    });
    if (!flushTimer) {
      flushTimer = setInterval(() => {
        void flush();
      }, DEFAULT_LEDGER_FLUSH_INTERVAL_MS);
      flushTimer.unref?.();
    }
    return writer;
  };

  const trackPending = (line, promise) => {
    pendingSyncWrites.push(line);
    return promise.finally(() => {
      const index = pendingSyncWrites.indexOf(line);
      if (index >= 0) pendingSyncWrites.splice(index, 1);
    });
  };

  const appendLine = (entry) => {
    const line = `${JSON.stringify(entry)}\n`;
    const target = ensureWriter();
    void trackPending(line, target.enqueue(line));
  };

  const appendLineSync = (entry) => {
    const line = `${JSON.stringify(entry)}\n`;
    try {
      fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
      fs.appendFileSync(ledgerPath, line);
    } catch {}
  };

  const buildEvent = (eventType, payload = null) => ({
    schemaVersion: BENCH_RUN_LEDGER_SCHEMA_VERSION,
    eventVersion: BENCH_RUN_LEDGER_EVENT_VERSION,
    ts: new Date().toISOString(),
    eventType,
    payload: payload && typeof payload === 'object' ? payload : {}
  });

  const flush = async () => {
    if (!writer?.flush) return;
    await runWithTimeout(
      () => writer.flush(),
      {
        timeoutMs: DEFAULT_LEDGER_CLOSE_TIMEOUT_MS,
        errorFactory: () => createTimeoutError({
          code: 'ERR_BENCH_RUN_LEDGER_FLUSH_TIMEOUT',
          message: 'Bench run ledger flush timed out.'
        })
      }
    );
  };

  const close = async () => {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    const target = writer;
    writer = null;
    if (!target) return;
    await flush();
    await runWithTimeout(
      () => target.close(),
      {
        timeoutMs: DEFAULT_LEDGER_CLOSE_TIMEOUT_MS,
        errorFactory: () => createTimeoutError({
          code: 'ERR_BENCH_RUN_LEDGER_CLOSE_TIMEOUT',
          message: 'Bench run ledger close timed out.'
        })
      }
    );
  };

  const closeSync = () => {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    if (!pendingSyncWrites.length) return;
    try {
      fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
      fs.appendFileSync(ledgerPath, pendingSyncWrites.join(''));
    } catch {}
    pendingSyncWrites.length = 0;
    writer = null;
  };

  const recordRunStarted = ({ plannedRepoCount = 0, taskCount = 0 }) => {
    appendLine(buildEvent('run.started', {
      runSuffix,
      plannedRepoCount: Number(plannedRepoCount || 0),
      taskCount: Number(taskCount || 0),
      diagnosticsRoot,
      configPath,
      reposRoot,
      cacheRoot,
      resultsRoot,
      masterLogPath,
      ledgerPath,
      summaryPath,
      footerPath,
      waiverFile: waiverFile || null,
      methodology: methodology || null
    }));
  };

  const recordRepoStarted = (plan) => {
    appendLine(buildEvent('repo.started', {
      language: toText(plan?.task?.language || plan?.language),
      tier: toText(plan?.task?.tier || plan?.tierLabel),
      repo: toText(plan?.task?.repo || plan?.repo),
      repoPath: toText(plan?.repoPath),
      outFile: toText(plan?.outFile)
    }));
  };

  const recordRepoCompleted = (result) => {
    const normalized = normalizeTaskEntry(result);
    appendLine(buildEvent('repo.completed', {
      result: normalized
    }));
    const crashRetention = normalized?.diagnostics?.crashRetention;
    if (crashRetention?.bundlePath) {
      appendLine(buildEvent('repo.crash_retained', crashRetention));
    }
  };

  const recordCloseoutEvent = (eventType, payload = null, { sync = false } = {}) => {
    const event = buildEvent(eventType, payload);
    if (sync) {
      appendLineSync(event);
    } else {
      appendLine(event);
    }
  };

  const writeFooterArtifact = async (summary, { sync = false } = {}) => {
    const lines = formatBenchRunFooter(summary);
    const text = `${lines.join('\n')}\n`;
    if (sync) {
      fs.mkdirSync(path.dirname(footerPath), { recursive: true });
      fs.writeFileSync(footerPath, text, 'utf8');
      return lines;
    }
    await fsPromises.mkdir(path.dirname(footerPath), { recursive: true });
    await fsPromises.writeFile(footerPath, text, 'utf8');
    return lines;
  };

  const buildSummary = async ({ output = null, endState, endReason = null, signal = null, exitCode = null }) => {
    recordCloseoutEvent('run.ended', {
      state: endState,
      reason: endReason,
      signal,
      exitCode,
      runStartedAt: null
    });
    await flush();
    const events = await readBenchRunLedger(ledgerPath);
    const summary = await buildBenchRunSummaryFromLedgerEvents({
      events,
      diagnosticsRoot,
      output,
      runSuffix,
      logPaths: {
        masterLogPath,
        footerPath,
        ledgerPath,
        summaryPath
      }
    });
    return summary;
  };

  const buildSummarySync = ({ endState, endReason = null, signal = null, exitCode = null }) => {
    recordCloseoutEvent('run.ended', {
      state: endState,
      reason: endReason,
      signal,
      exitCode,
      runStartedAt: null
    }, { sync: true });
    const raw = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, 'utf8') : '';
    const events = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const summary = {
      schemaVersion: BENCH_RUN_SUMMARY_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      runSuffix,
      run: {
        state: endState,
        reason: endReason,
        signal,
        exitCode: Number.isFinite(Number(exitCode)) ? Number(exitCode) : null,
        plannedRepoCount: Number(events.find((entry) => entry.eventType === 'run.started')?.payload?.plannedRepoCount || 0),
        finishedRepoCount: events.filter((entry) => entry.eventType === 'repo.completed').length
      },
      verdict: evaluateBenchVerdict({
        tasks: events
          .filter((entry) => entry.eventType === 'repo.completed')
          .map((entry) => normalizeTaskEntry(entry.payload?.result))
          .filter(Boolean),
        policy: {
          schemaVersion: 1,
          policyVersion: 'bench-language-policy-v1',
          waiverFile: null,
          waiverSchemaVersion: 1,
          waivers: [],
          loadErrors: []
        }
      }).run,
      counts: {
        planned: Number(events.find((entry) => entry.eventType === 'run.started')?.payload?.plannedRepoCount || 0),
        started: events.filter((entry) => entry.eventType === 'repo.started').length,
        finished: events.filter((entry) => entry.eventType === 'repo.completed').length,
        unfinished: Math.max(
          0,
          Number(events.find((entry) => entry.eventType === 'run.started')?.payload?.plannedRepoCount || 0)
            - events.filter((entry) => entry.eventType === 'repo.completed').length
        )
      },
      unfinishedRepos: [],
      parities: {
        crashRetention: {
          ledgerCount: events.filter((entry) => entry.eventType === 'repo.crash_retained').length,
          directoryCount: 0,
          outputCount: null,
          ok: true,
          missingOnDisk: [],
          missingInLedger: [],
          missingInOutput: []
        }
      },
      paths: {
        masterLogPath,
        footerPath,
        ledgerPath,
        summaryPath,
        diagnosticsRoot
      },
      closeout: {
        eventCount: events.length,
        closeoutStarted: events.some((entry) => entry.eventType === 'closeout.started'),
        closeoutSummaryWritten: false,
        closeoutFooterWritten: false,
        closeoutFailures: []
      }
    };
    return summary;
  };

  const writeSummaryArtifact = async (summary) => {
    await fsPromises.mkdir(path.dirname(summaryPath), { recursive: true });
    await fsPromises.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  };

  const writeSummaryArtifactSync = (summary) => {
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  };

  return {
    ledgerPath,
    summaryPath,
    footerPath,
    flush,
    close,
    closeSync,
    recordRunStarted,
    recordRepoStarted,
    recordRepoCompleted,
    recordCloseoutEvent,
    writeSummaryArtifact,
    writeSummaryArtifactSync,
    writeFooterArtifact,
    buildSummary,
    buildSummarySync
  };
};
