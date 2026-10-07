#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { hasIndexMeta } from '../../src/retrieval/cli/index-loader.js';
import { loadUserConfig, getIndexDir } from '../shared/dict-utils.js';
import { captureCommandDebugRun, captureSearchDebugRun } from './search-debug-capture.js';

const DEFAULT_DATASET = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'pairofcleats-search-showcase',
  'showcase.json'
);
const DEFAULT_SEARCH_ENTRYPOINT = path.join(
  process.cwd(),
  'tools',
  'search',
  'cli-entry.js'
);

const USAGE = `Usage:
  node tools/testing/run-search-showcase.js [options]

Options:
  --repo <path>                 Repo root to search (default: cwd)
  --dataset <path>              Showcase dataset JSON
  --logs-root <path>            Output root (default: .testLogs/search-showcase)
  --case <id>                   Run only the named case (repeatable)
  --category <name>             Run only matching categories (repeatable)
  --include-optional            Include optional cases
  --include-exploratory         Include exploratory cases
  --max-cases <n>               Limit selected cases
  --size <cols>x<rows>|default  Override terminal sizes (repeatable)
  --pty                         Capture each run through a real PTY/ConPTY terminal
  --list                        List selected cases and exit
  --json-summary                Print JSON summary to stdout
  --no-force-color              Do not force ANSI color env vars
  --help                        Show this help
`;

const DEFAULT_TERMINAL_SIZES = Object.freeze([
  { id: 'default', columns: null, lines: null },
  { id: '72x20', columns: 72, lines: 20 },
  { id: '88x24', columns: 88, lines: 24 },
  { id: '104x28', columns: 104, lines: 28 },
  { id: '132x34', columns: 132, lines: 34 },
  { id: '188x30', columns: 188, lines: 30 },
  { id: '220x50', columns: 220, lines: 50 }
]);

const toArray = (value) => (Array.isArray(value) ? value : []);

const parseArgs = (argv) => {
  const options = {
    repoRoot: process.cwd(),
    datasetPath: DEFAULT_DATASET,
    logsRoot: null,
    caseIds: [],
    categories: [],
    includeOptional: false,
    includeExploratory: false,
    maxCases: 0,
    sizes: [],
    pty: false,
    list: false,
    jsonSummary: false,
    forceColor: true,
    help: false
  };
  const args = Array.isArray(argv) ? argv.slice() : [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || '');
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--include-optional') {
      options.includeOptional = true;
      continue;
    }
    if (arg === '--include-exploratory') {
      options.includeExploratory = true;
      continue;
    }
    if (arg === '--list') {
      options.list = true;
      continue;
    }
    if (arg === '--pty') {
      options.pty = true;
      continue;
    }
    if (arg === '--json-summary') {
      options.jsonSummary = true;
      continue;
    }
    if (arg === '--no-force-color') {
      options.forceColor = false;
      continue;
    }
    if (
      arg === '--repo'
      || arg === '--dataset'
      || arg === '--logs-root'
      || arg === '--case'
      || arg === '--category'
      || arg === '--max-cases'
      || arg === '--size'
    ) {
      const next = args[index + 1];
      if (next == null) {
        throw new Error(`Missing value for ${arg}`);
      }
      if (arg === '--repo') options.repoRoot = path.resolve(String(next));
      if (arg === '--dataset') options.datasetPath = path.resolve(String(next));
      if (arg === '--logs-root') options.logsRoot = path.resolve(String(next));
      if (arg === '--case') options.caseIds.push(String(next));
      if (arg === '--category') options.categories.push(String(next).toLowerCase());
      if (arg === '--max-cases') options.maxCases = Math.max(0, parseInt(String(next), 10) || 0);
      if (arg === '--size') options.sizes.push(String(next));
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
};

export const loadSearchShowcaseDataset = (datasetPath = DEFAULT_DATASET) => {
  const resolved = path.resolve(datasetPath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid showcase dataset at ${resolved}`);
  }
  if (parsed.tool !== 'pairofcleats') {
    throw new Error(`Expected showcase tool to be "pairofcleats" in ${resolved}`);
  }
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error(`Expected non-empty cases array in ${resolved}`);
  }
  return {
    datasetPath: resolved,
    dataset: parsed
  };
};

const parseTerminalSizeSpec = (value) => {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === 'default') {
    return { id: 'default', columns: null, lines: null };
  }
  const match = text.match(/^(\d{2,4})x(\d{2,4})$/u);
  if (!match) {
    throw new Error(`Invalid --size value: ${value}`);
  }
  const columns = parseInt(match[1], 10);
  const lines = parseInt(match[2], 10);
  if (!Number.isFinite(columns) || !Number.isFinite(lines) || columns < 20 || lines < 10) {
    throw new Error(`Invalid --size value: ${value}`);
  }
  return { id: `${columns}x${lines}`, columns, lines };
};

export const resolveTerminalSizeMatrix = (values = []) => {
  if (!Array.isArray(values) || values.length === 0) {
    return [...DEFAULT_TERMINAL_SIZES];
  }
  const seen = new Set();
  const resolved = [];
  for (const raw of values) {
    const entry = parseTerminalSizeSpec(raw);
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    resolved.push(entry);
  }
  return resolved;
};

export const selectSearchShowcaseCases = (dataset, options = {}) => {
  const includeStabilities = new Set(['stable']);
  if (options.includeOptional) includeStabilities.add('optional');
  if (options.includeExploratory) includeStabilities.add('exploratory');
  const caseIdFilter = new Set(toArray(options.caseIds).map((entry) => String(entry)));
  const categoryFilter = new Set(
    toArray(options.categories)
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const selected = [];
  for (const entry of dataset.cases) {
    const id = String(entry?.id || '').trim();
    const category = String(entry?.category || '').trim().toLowerCase();
    const stability = String(entry?.stability || 'stable').trim().toLowerCase();
    if (!id) continue;
    if (!includeStabilities.has(stability)) continue;
    if (caseIdFilter.size > 0 && !caseIdFilter.has(id)) continue;
    if (categoryFilter.size > 0 && !categoryFilter.has(category)) continue;
    selected.push(entry);
  }
  if (options.maxCases > 0) {
    return selected.slice(0, options.maxCases);
  }
  return selected;
};

const formatListLine = (entry) => {
  const requires = Array.isArray(entry?.requires) && entry.requires.length
    ? ` requires=${entry.requires.join(',')}`
    : '';
  const kind = Array.isArray(entry?.commandArgs) && entry.commandArgs.length ? 'command' : 'query';
  return `${entry.id} [${entry.stability}] (${entry.category}, ${kind})${requires}`;
};

const buildCaseArgs = (dataset, entry) => {
  if (Array.isArray(entry?.commandArgs) && entry.commandArgs.length) {
    return entry.commandArgs.map((arg) => String(arg));
  }
  const defaults = toArray(dataset?.executionDefaults?.searchArgs);
  const args = [...defaults];
  const mode = String(entry?.mode || '').trim();
  if (mode) {
    args.push('--mode', mode);
  }
  for (const arg of toArray(entry?.args)) {
    args.push(String(arg));
  }
  if (entry?.query != null) {
    args.push('--', String(entry.query));
  }
  return args;
};

const toSafeLabel = (value) => String(value || 'search')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'search';

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const timestampToken = () => new Date().toISOString().replace(/[:.]/g, '-');

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isSectionLine = (line) => {
  const text = String(line || '').trim();
  if (!text) return false;
  if (text.includes('Results (') || text.includes('Diagnostics (')) return true;
  return text === 'Usage'
    || text === 'Modes'
    || text === 'Filters'
    || text === 'Output'
    || text === 'Starter Recipes'
    || text === 'Notes';
};

const countRenderedSections = (text) => String(text || '')
  .split(/\r?\n/u)
  .filter((line) => isSectionLine(line))
  .length;

const countEmptyRenderedSections = (text) => {
  const lines = String(text || '').split(/\r?\n/u);
  let emptyCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!isSectionLine(lines[index])) continue;
    let cursor = index + 1;
    let hasContent = false;
    while (cursor < lines.length && !isSectionLine(lines[cursor])) {
      if (String(lines[cursor] || '').trim()) {
        hasContent = true;
        break;
      }
      cursor += 1;
    }
    if (!hasContent) emptyCount += 1;
  }
  return emptyCount;
};

const loadReviewSurfaceText = (meta, captureMode) => {
  if (captureMode === 'pty') {
    const terminalPlain = meta?.files?.terminalPlain;
    return terminalPlain && fs.existsSync(terminalPlain) ? fs.readFileSync(terminalPlain, 'utf8') : '';
  }
  const stdoutPlain = meta?.files?.stdoutPlain;
  const stderrPlain = meta?.files?.stderrPlain;
  const stdoutText = stdoutPlain && fs.existsSync(stdoutPlain) ? fs.readFileSync(stdoutPlain, 'utf8') : '';
  const stderrText = stderrPlain && fs.existsSync(stderrPlain) ? fs.readFileSync(stderrPlain, 'utf8') : '';
  return `${stdoutText}${stderrText}`;
};

const evaluateReviewExpectations = (text, reviewExpect = null) => {
  const contains = toArray(reviewExpect?.contains).map((entry) => String(entry));
  const missingExpected = contains.filter((entry) => !text.includes(entry));
  return {
    missingExpected,
    missingExpectedCount: missingExpected.length,
    sectionCount: countRenderedSections(text),
    emptySectionCount: countEmptyRenderedSections(text)
  };
};

const deriveRunReview = (run) => {
  const review = run?.review && typeof run.review === 'object' ? run.review : {};
  const overflowCount = toFiniteNumber(review.overflowCount, 0);
  const blankPairCount = toFiniteNumber(review.blankPairCount, 0);
  const usedWidth = toFiniteNumber(review.usedWidth, 0);
  const columns = toFiniteNumber(run?.terminalSize?.columns, 0);
  const diagnosticPollution = toFiniteNumber(review.diagnosticPollution, 0);
  const missingExpectedCount = toFiniteNumber(review.missingExpectedCount, 0);
  const emptySectionCount = toFiniteNumber(review.emptySectionCount, 0);
  const sectionCount = toFiniteNumber(review.sectionCount, 0);
  const widthOverflow = columns > 0 && usedWidth > columns ? usedWidth - columns : 0;
  const score = (run?.status !== 'ok' ? 1000 : 0)
    + (overflowCount * 10)
    + (blankPairCount * 20)
    + (diagnosticPollution * 30)
    + (missingExpectedCount * 40)
    + (emptySectionCount * 50)
    + widthOverflow;
  return {
    overflowCount,
    blankPairCount,
    usedWidth,
    widthOverflow,
    diagnosticPollution,
    missingExpectedCount,
    emptySectionCount,
    sectionCount,
    score
  };
};

export const buildSearchShowcaseReviewReport = (summary) => {
  const runs = Array.isArray(summary?.runs) ? summary.runs : [];
  const scoredRuns = runs.map((run) => ({
    id: run.id,
    terminalSize: run.terminalSize?.id || 'default',
    captureMode: run.captureMode || 'pipe',
    status: run.status || 'unknown',
    outputDir: run.outputDir,
    ...deriveRunReview(run)
  }));
  const worstRuns = [...scoredRuns]
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, 20);
  return {
    generatedAt: new Date().toISOString(),
    suiteDir: summary?.suiteDir || null,
    totalRuns: runs.length,
    overflowCount: scoredRuns.reduce((total, run) => total + run.overflowCount, 0),
    blankPairCount: scoredRuns.reduce((total, run) => total + run.blankPairCount, 0),
    diagnosticPollutionCount: scoredRuns.reduce((total, run) => total + run.diagnosticPollution, 0),
    missingExpectedCount: scoredRuns.reduce((total, run) => total + run.missingExpectedCount, 0),
    emptySectionCount: scoredRuns.reduce((total, run) => total + run.emptySectionCount, 0),
    worstRuns
  };
};

const formatSearchShowcaseReviewReport = (report) => {
  const lines = [
    'Search Display Review',
    `suiteDir: ${report?.suiteDir || '(unknown)'}`,
    `totalRuns: ${report?.totalRuns || 0}`,
    `overflowCount: ${report?.overflowCount || 0}`,
    `blankPairCount: ${report?.blankPairCount || 0}`,
    `diagnosticPollutionCount: ${report?.diagnosticPollutionCount || 0}`,
    `missingExpectedCount: ${report?.missingExpectedCount || 0}`,
    `emptySectionCount: ${report?.emptySectionCount || 0}`,
    'worstRuns:'
  ];
  const worstRuns = Array.isArray(report?.worstRuns) ? report.worstRuns : [];
  if (!worstRuns.length) {
    lines.push('  (none)');
  } else {
    for (const run of worstRuns) {
      lines.push(
        `  ${run.id}@${run.terminalSize} score=${run.score} overflow=${run.overflowCount} blankPairs=${run.blankPairCount} missing=${run.missingExpectedCount} emptySections=${run.emptySectionCount} outputDir=${run.outputDir}`
      );
    }
  }
  lines.push('');
  return lines.join('\n');
};

const hasUsableIndex = (repoRoot) => {
  const userConfig = loadUserConfig(repoRoot);
  const dirs = [
    getIndexDir(repoRoot, 'code', userConfig),
    getIndexDir(repoRoot, 'prose', userConfig),
    getIndexDir(repoRoot, 'extracted-prose', userConfig)
  ];
  return dirs.some((dir) => hasIndexMeta(dir));
};

export const runSearchShowcaseCli = async (argv = process.argv.slice(2)) => {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error?.message || error);
    console.error(USAGE);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  let loaded;
  try {
    loaded = loadSearchShowcaseDataset(options.datasetPath);
  } catch (error) {
    console.error(error?.message || error);
    return 1;
  }
  let terminalSizes;
  try {
    terminalSizes = resolveTerminalSizeMatrix(options.sizes);
  } catch (error) {
    console.error(error?.message || error);
    return 1;
  }

  const selected = selectSearchShowcaseCases(loaded.dataset, options);
  if (options.list) {
    for (const entry of selected) {
      console.log(formatListLine(entry));
    }
    return 0;
  }
  if (!selected.length) {
    console.error('No showcase cases matched the selection.');
    return 1;
  }
  if (!hasUsableIndex(options.repoRoot)) {
    console.error(`No search index found for ${options.repoRoot}`);
    console.error('Run `pairofcleats index build` first, then rerun this showcase.');
    return 1;
  }

  const logsRoot = path.resolve(
    options.logsRoot || path.join(options.repoRoot, '.testLogs', 'search-showcase')
  );
  const suiteDir = path.join(logsRoot, `${timestampToken()}-repo-self-showcase`);
  ensureDir(suiteDir);

  const runs = [];
  let failures = 0;
  for (const entry of selected) {
    const commandArgs = buildCaseArgs(loaded.dataset, entry);
    const entrypoint = path.resolve(
      options.repoRoot,
      String(entry?.entrypoint || loaded.dataset?.executionDefaults?.entrypoint || DEFAULT_SEARCH_ENTRYPOINT)
    );
    const expectedExitCode = Number.isFinite(Number(entry?.expectedExitCode))
      ? Number(entry.expectedExitCode)
      : 0;
    for (const terminalSize of terminalSizes) {
      const sizeLabel = terminalSize.id;
      console.log(`running ${entry.id} @ ${sizeLabel}`);
      const env = { ...process.env };
      if (terminalSize.columns != null) {
        env.COLUMNS = String(terminalSize.columns);
      } else {
        delete env.COLUMNS;
      }
      if (terminalSize.lines != null) {
        env.LINES = String(terminalSize.lines);
      } else {
        delete env.LINES;
      }
      const commonCaptureOptions = {
        rootDir: options.repoRoot,
        cwd: options.repoRoot,
        logsRoot: suiteDir,
        label: toSafeLabel(entry.id),
        env,
        forceColor: options.forceColor,
        trackedEnvKeys: ['COLUMNS', 'LINES'],
        outputSuffix: sizeLabel
      };
      const meta = options.pty
        ? await captureSearchDebugRun({
          ...commonCaptureOptions,
          searchArgs: commandArgs,
          pty: true,
          cols: terminalSize.columns,
          rows: terminalSize.lines,
          searchEntrypoint: entrypoint
        })
        : await captureCommandDebugRun({
          ...commonCaptureOptions,
          command: process.execPath,
          args: [entrypoint, ...commandArgs],
          parseStdoutAsJson: false
        });
      const reviewText = loadReviewSurfaceText(meta, meta.mode || 'pipe');
      const expectationReview = evaluateReviewExpectations(reviewText, entry.reviewExpect || null);
      const status = meta.exitCode === expectedExitCode ? 'ok' : 'failed';
      if (status !== 'ok') failures += 1;
      runs.push({
        id: entry.id,
        title: entry.title,
        category: entry.category,
        stability: entry.stability,
        requires: toArray(entry.requires),
        status,
        exitCode: meta.exitCode,
        expectedExitCode,
        captureMode: meta.mode || 'pipe',
        outputDir: meta.outputDir,
        query: entry.query || null,
        mode: entry.mode || null,
        review: meta.mode === 'pty'
          ? {
            overflowCount: Number(meta.screen?.overflowCount) || 0,
            blankPairCount: Number(meta.screen?.blankPairCount) || 0,
            usedWidth: Number(meta.screen?.usedWidth) || 0,
            ...expectationReview
          }
          : {
            diagnosticPollution: entry.category === 'machine'
              && meta.stdout?.parsedAsJson === false
              && Number(meta.stderr?.bytes || 0) > 0
              ? 1
              : 0,
            ...expectationReview
          },
        terminalSize: {
          id: terminalSize.id,
          columns: terminalSize.columns,
          lines: terminalSize.lines
        },
        entrypoint,
        commandArgs
      });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    tool: loaded.dataset.tool,
    dataset: loaded.datasetPath,
    repoRoot: options.repoRoot,
    suiteDir,
    selectedCount: selected.length,
    terminalSizes,
    totalRuns: runs.length,
    failureCount: failures,
    runs
  };
  fs.writeFileSync(path.join(suiteDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const reviewReport = buildSearchShowcaseReviewReport(summary);
  fs.writeFileSync(path.join(suiteDir, 'review-report.json'), `${JSON.stringify(reviewReport, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(suiteDir, 'review-report.txt'), formatSearchShowcaseReviewReport(reviewReport), 'utf8');

  if (options.jsonSummary) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`search showcase captured: ${suiteDir}`);
    console.log(`selected=${summary.selectedCount} failures=${summary.failureCount}`);
  }
  return failures > 0 ? 1 : 0;
};

if (isDirectExecution(import.meta.url)) {
  const exitCode = await runSearchShowcaseCli();
  process.exitCode = Number.isFinite(Number(exitCode)) ? Number(exitCode) : 1;
}
